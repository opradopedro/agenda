# Agenda IA — Plano de arquitetura

Organizador semanal pessoal: captura em linguagem natural → IA estrutura em
tarefas → agendador determinístico encaixa na semana → check-in por
notificação → reorganiza.

> Status: **proposta para aprovação** (antes da Fase 1).
> Modelo de dados em SQL: [`supabase/migrations/20261010000000_init.sql`](../supabase/migrations/20261010000000_init.sql).

---

## 1. Visão geral

```
┌──────────────────────────── Cliente (um só código) ─────────────────────────────┐
│ React + Vite + TS (PWA)          │  Android = mesmo build empacotado (Capacitor) │
│                                  │                                               │
│  Telas: Hoje · Semana · Caixa de entrada · Config · Onboarding · Check-in       │
│                                                                                  │
│  core/scheduler  ◄── TS puro, sem dependências, determinístico (mesmo arquivo    │
│                      que roda nas Edge Functions)                                │
│  data/           ◄── IndexedDB (Dexie) como cache local + fila de sincronização  │
│  notify/         ◄── adaptador: Web Push (desktop) | LocalNotifications (Android)│
│  voice/          ◄── adaptador: Web Speech API (desktop) | plugin nativo (Android)│
└───────────────┬──────────────────────────────────────────────────────────────────┘
                │ supabase-js (JWT do usuário, RLS)
┌───────────────▼──────────────────────── Supabase (free) ────────────────────────┐
│ Auth (Google)   Postgres + RLS   Vault (refresh token do Google)                 │
│ Edge Functions (Deno):                                                           │
│   interpret     texto → JSON de tarefas (via _shared/llm)                        │
│   checkin       aplica Terminei / Mais tempo / Remarcar e replaneja              │
│   gcal-sync     lê eventos → compromissos; escreve blocos → calendário "Agenda IA"│
│   push-dispatch envia Web Push das notificações vencidas                         │
│   cook          receitas + lista de compras (Fase 4)                             │
│ pg_cron + pg_net: a cada minuto verifica a fila de notificações (só chama a      │
│   function se houver algo vencido); a cada 15 min sincroniza o Google Calendar;  │
│   1×/dia gera instâncias de rotinas recorrentes.                                 │
└───────────────┬─────────────────────────────────────┬────────────────────────────┘
                │                                     │
        Gemini API (Flash, free)            Google Calendar API (leitura+escrita)
        só via _shared/llm                  (eventos sem lembrete: só visual)
```

### Princípios

1. **A IA interpreta, o código decide.** O LLM só transforma texto em JSON
   validado (zod). Quem escolhe horário é o agendador determinístico — mesma
   entrada, mesma saída, testável com testes unitários.
2. **Offline-first.** A UI lê e escreve no IndexedDB; um motor de sync
   empurra/puxa do Postgres (last-write-wins por `updated_at`, soft delete com
   `deleted_at`). Só um usuário, poucos dispositivos → LWW é suficiente.
3. **Um agendador, dois lugares.** O código fica em
   `supabase/functions/_shared/scheduler/` e o app importa o mesmo arquivo via
   alias do Vite. Assim um check-in feito pela notificação do desktop (sem app
   aberto) replaneja no servidor com exatamente a mesma lógica.
4. **LLM trocável.** Toda chamada passa por `_shared/llm` (interface única);
   o provedor é escolhido por variável de ambiente.

---

## 2. Estrutura do repositório

```
agenda/
├─ app/                         React + Vite + TS (PWA)
│  ├─ src/
│  │  ├─ core/                  tipos de domínio, regras de local, datas (fuso)
│  │  ├─ data/                  Dexie (local) · sync com Supabase (Fase 2)
│  │  ├─ features/
│  │  │  ├─ capture/            campo livre + microfone
│  │  │  ├─ inbox/              capturas e tarefas sem horário
│  │  │  ├─ proposal/           revisar/editar/aprovar plano
│  │  │  ├─ today/              linha do tempo do dia
│  │  │  ├─ week/               visão semanal
│  │  │  ├─ checkin/            tela com os 3 botões
│  │  │  ├─ settings/           config (modo, notificações, rotina)
│  │  │  └─ onboarding/
│  │  ├─ notify/                web-push.ts · capacitor-local.ts
│  │  └─ voice/                 web-speech.ts · capacitor-speech.ts
│  ├─ public/sw.js              service worker (cache + push + ações)
│  └─ android/                  gerado pelo Capacitor (Fase 3)
├─ supabase/
│  ├─ migrations/
│  └─ functions/
│     ├─ _shared/
│     │  ├─ llm/                types.ts · gemini.ts · index.ts (factory)
│     │  ├─ scheduler/          agendador puro + testes
│     │  └─ schemas/            zod: saída da IA, payloads
│     ├─ interpret/  checkin/  gcal-sync/  push-dispatch/  cook/
└─ docs/
```

---

## 3. Módulo `llm` (trocável)

```ts
// supabase/functions/_shared/llm/types.ts
export interface LLMRequest {
  system: string;
  user: string;
  jsonSchema: object;        // schema da resposta (structured output)
  temperature?: number;
}
export interface LLMResult<T> {
  data: T;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}
export interface LLMProvider {
  generateJSON<T>(req: LLMRequest): Promise<LLMResult<T>>;
}
```

- `gemini.ts` implementa via REST (`generateContent` com
  `responseMimeType: "application/json"` + `responseSchema`).
- `index.ts` lê `LLM_PROVIDER`, `LLM_MODEL` (padrão `gemini-3.5-flash`) e
  `LLM_FALLBACK_MODEL` (padrão `gemini-3.5-flash-lite`). Em cota esgotada, tempo
  esgotado ou erro do provedor, tenta o fallback.
- O aviso de cada tarefa (lembrete/alarme/nenhum) não vem da IA: começa no
  padrão da Config e você muda na proposta.
- Toda chamada grava uma linha em `llm_usage`; a tela de Config mostra o uso do
  dia, e a function recusa chamadas acima de um teto diário configurável
  (`LLM_DAILY_CAP`) para nunca estourar o gratuito.
- A saída é validada com zod; se vier inválida, uma única nova tentativa com a
  mensagem de erro, depois falha visível na Caixa de entrada.

### Contrato da interpretação (`interpret`)

Entrada: texto + contexto (data/hora atual, dia da semana, fuso, resumo da
rotina, categorias). Saída:

```jsonc
{
  "events": [            // coisas com hora/dia marcados que NÃO são tarefas
    { "title": "Prova", "date": "2026-10-15", "start": null, "end": null, "category": "faculdade" }
  ],
  "tasks": [
    {
      "title": "Marmitas da semana",
      "category": "pessoal",          // pessoal | faculdade | tcc | empresa_junior | trabalho
      "duration_min": 150,            // soma das subtarefas quando houver
      "deadline": "2026-10-12T12:00:00-03:00",
      "deadline_hard": false,
      "priority": 3,                  // 1 baixa … 4 urgente
      "location": "qualquer",         // casa | rua | qualquer
      "region": null,                 // só p/ rua, se você disser onde ("dentista em Praia Grande")
      "is_cooking": true,
      "inferred": false,              // true = sugestão da IA (ex.: "estudar p/ prova")
      "subtasks": [
        { "title": "Comprar ingredientes", "duration_min": 40, "location": "rua", "region": null },
        { "title": "Cozinhar",             "duration_min": 90, "location": "casa" },
        { "title": "Porcionar",            "duration_min": 20, "location": "casa" }
      ]
    }
  ],
  "questions": []        // dúvidas que a IA não conseguiu resolver
}
```

Tarefas `inferred: true` aparecem desmarcadas na proposta.

---

## 4. Agendador (determinístico)

Entrada: horizonte (agora → +7 dias), perfil, rotina fixa, eventos (Google +
capturados), matriz de deslocamento, blocos já confirmados e a lista de
tarefas a encaixar. Saída: blocos propostos + tarefas que não couberam (com
motivo). Sem `Date.now()` nem aleatoriedade dentro — "agora" é parâmetro.

### Passo 1 — linha do tempo de lugares

Cada lugar tem uma **região** (cidade). No seu caso: casa em **Praia Grande**;
trabalho, terminal e faculdade em **Santos**. Para cada dia, o agendador
expande compromissos fixos e eventos em intervalos com lugar e região. Entre
dois compromissos A → B:

| Situação | Janela gerada |
|---|---|
| Acordar → sair para o 1º compromisso | `casa` (Praia Grande), de `wake_time` até `início(B) − desloc(casa→B)` |
| A em casa (ex.: home office) → B fora | `casa` até a hora de sair para B |
| A fora → B fora | `fora`, na região de A (ex.: Santos). Só volta pra casa no meio se `return_home_in_gaps` estiver ligado **e** sobrar ≥ `go_home_min_stay_min` em casa. No seu perfil fica **desligado** |
| Último compromisso fora → dormir | primeiro uma janela `fora` opcional na região (dá pra emendar médico, cabelo, compras antes de voltar); o que for usado ali atrasa a chegada em casa. Depois, `casa` de `chegada` até `sleep_time` |

Exemplo (dia de escritório): 16h → 18h45 é janela **fora, em Santos** (15 min
para chegar na faculdade). Cabem médico, cabelo, mercado, estudar; não cabem
arrumar o quarto ou cozinhar. Num dia sem faculdade, uma tarefa de rua em Santos
pode ser emendada às 16h e você chega em casa depois.

Na quarta (home office) o estágio é em casa: antes das 9h, depois das 16h até
sair para a faculdade e a noite viram janelas `casa` grandes. Por isso as
tarefas de casa naturalmente caem ali.

Deslocamentos são blocos ocupados (mostrados na linha do tempo, não usados).

### Passo 2 — compatibilidade local × janela

| Tarefa \ janela | `casa` | `fora` |
|---|---|---|
| `casa`     | ✔ | ✘ |
| `rua`      | ✔ com custo extra de ida/volta (`errand_from_home_overhead_min`, padrão 30) | ✔ |
| `qualquer` | ✔ | ✔ |

Tarefas `rua` podem ter **região** ("dentista em Praia Grande"). Com região,
só entram em janelas daquela região: um dentista em Praia Grande vai para uma
saída a partir de casa, não para o intervalo em Santos. Sem região, entram em
qualquer uma. A IA preenche a região quando você fala o lugar.

### Passo 3 — encaixe

1. Só folhas são agendadas (pais com subtarefas viram contêineres). Subtarefas
   respeitam a ordem (`seq`): a k-ésima só começa depois do fim da (k−1)-ésima.
2. Ordem de processamento: prazo mais cedo primeiro (EDF), desempate por
   prioridade (maior), depois duração (maior), depois `id` (estabilidade).
3. Para cada tarefa, enumera inícios candidatos em grade de
   `slot_granularity_min` (15) nas janelas compatíveis, respeitando
   `earliest_start`, prazo, `task_buffer_min` entre tarefas e horário de
   silêncio/sono. Cada candidato recebe um **custo**:
   - folga até o prazo (quanto mais perto do limite, maior o custo);
   - horário ruim (após 22h, colado no horário de dormir);
   - fragmentação (deixa sobra inútil < 30 min na janela);
   - para `rua` em janela `casa`: o custo da saída extra.
   Escolhe o menor custo; empate → mais cedo. Tarefas `splittable` (ex.: TCC
   4h) podem ser divididas em pedaços ≥ `min_chunk_min`.
4. O que não cabe volta com motivo: "não cabe antes do prazo", "nenhuma janela
   em casa até sexta", etc.

### Passo 4 — replanejamento (reparo mínimo)

Replanejar **não** embaralha a semana: blocos confirmados ficam fixos, exceto
os que agora conflitam. Só eles + a tarefa afetada voltam para o Passo 3.

| Check-in | Efeito |
|---|---|
| **Terminei** | bloco `concluido`, tarefa `concluida`, registra tempo real |
| **Preciso de mais tempo** | estende o bloco em `more_time_default_min` (15; na tela dá pra escolher 15/30/60); blocos seguintes que conflitarem são re-encaixados |
| **Remarcar** | bloco `remarcado`; a tarefa volta ao pool com `earliest_start = agora + 30 min` |

Modo **direto**: aplica e reagenda notificações. Modo **proposta**: gera um
plano `proposta` e notifica "Nova proposta pronta" (para check-ins, a extensão
de "mais tempo" é sempre aplicada na hora; só o efeito dominó vira proposta).

---

## 5. Notificações

Os avisos vêm **só do app**. Os eventos no Google Calendar são criados **sem
lembrete** e servem apenas para você ver a agenda (§6).

| Onde | Como |
|---|---|
| Android | `@capacitor/local-notifications`, agendadas no aparelho (funcionam sem internet), com 3 botões de ação. |
| Desktop | Web Push (VAPID) pelo service worker. Fila `notification_jobs`; pg_cron a cada minuto chama `push-dispatch` só se houver item vencido. |

### Tipo de aviso, escolhido por tarefa

Na proposta (e na edição) cada tarefa tem um seletor. O padrão fica em Config
(`default_alert_mode`, inicialmente **Lembrete**).

| Modo | Comportamento |
|---|---|
| **Lembrete** (padrão) | Notificação comum: um toque curto de notificação (ou nenhum, no modo silencioso) e fica na gaveta. **Não toca como despertador.** |
| **Alarme** | Toca como despertador, com som contínuo e tela cheia, até você dispensar. Para o que não pode perder (prova, médico). |
| **Nenhum** | Sem notificação; o check-in aparece pendente na tela Hoje quando você abrir o app. |

"Alarme exato" (permissão do Android) **não** significa tocar alarme: é só o
nome do agendamento que dispara no minuto certo, mesmo com o celular em
economia de bateria. Os lembretes usam esse agendamento para não chegarem
atrasados.

O **Alarme** precisa de um pedaço nativo pequeno na Fase 3: canal com som de
alarme repetindo e notificação de tela cheia. O plugin padrão do Capacitor não
faz isso.

### Pouca notificação

- **No máximo uma notificação do app por vez na gaveta.** Todas usam o mesmo
  identificador, então a nova substitui a anterior em vez de empilhar. Check-ins
  não respondidos ficam pendentes na tela Hoje, não na gaveta.
- Por tarefa: uma no início ("Agora: Cozinhar, até 15h30") e uma no fim
  (check-in), que **substitui** a do início. O aviso do início e o do fim
  ligam/desligam separadamente em Config.
- **Silêncio**: padrão 00h → horário de acordar (editável). Nada é agendado
  nessa faixa; o que cairia ali vai para o primeiro minuto depois. Alarmes
  também respeitam o silêncio, salvo se você marcar a tarefa como exceção.
- **Modo silencioso**: lembretes sem som nem vibração (canal de baixa
  importância no Android; `silent: true` no Web Push).
- **Silêncio**: padrão 00h → horário de acordar (editável). Nada é agendado
  nessa faixa; o que cairia ali vai para o primeiro minuto depois.
- **Modo silencioso**: notifica sem som/vibração (canal de baixa importância no
  Android; `silent: true` no Web Push).
- **Botões no desktop**: o Chrome mostra no máximo **2 botões** por
  notificação. No desktop: "Terminei" e "Mais tempo"; clicar na notificação
  abre a tela de check-in com os 3. No Android, os 3 botões.
- **Ação sem abrir o app (desktop)**: o payload leva um token HMAC de uso único
  por bloco; o service worker chama `checkin` direto, que replaneja no
  servidor.
- **Android**: ações das notificações são tratadas no app (Capacitor),
  que replaneja localmente e sincroniza. Na Fase 3 avalio um receiver nativo
  para "Terminei" funcionar sem trazer o app para a frente.
- **Limitação conhecida**: se o plano mudar no desktop, o celular só reagenda
  os avisos quando o app abrir ou voltar para a frente. Até lá, um aviso pode
  sair no horário antigo. Se incomodar, dá para adicionar FCM (gratuito) depois.
  Outra opção é ligar os lembretes do Calendar como reserva (§6).

---

## 6. Google Calendar

- Login Google via Supabase Auth com `access_type=offline` e
  `prompt=consent`; o refresh token vai para o **Vault** (schema `private`,
  nunca exposto à API).
- Escopos: `calendar.app.created` (criar o calendário "Agenda IA" e gerenciar
  os eventos dele) + `calendar.events.readonly` (ler seus outros calendários).
- **Leitura**: calendários escolhidos em Config → tabela `events`
  (`source='gcal'`) via `syncToken` incremental. Eventos "disponível"
  (`transparency=transparent`) não bloqueiam.
- **Escrita**: cada bloco confirmado vira ou atualiza um evento no calendário
  "Agenda IA". Como é um calendário separado, ele nunca é lido de volta como
  compromisso.
- **Sem notificação do Calendar**: os eventos são criados com
  `reminders: { useDefault: false, overrides: [] }`. O calendário "Agenda IA" é
  criado sem lembretes padrão (`defaultReminders: []`) e sem convidados
  (`sendUpdates: "none"`), então o app do Google Agenda não avisa nada nem manda
  e-mail. Em Config há a chave "Lembretes do Google Calendar"
  (`gcal_reminders`, desligada), caso um dia você queira essa reserva.

---

## 7. Voz (pt-BR)

- Desktop: Web Speech API (Chrome/Edge; o Firefox não tem). Gratuita; o áudio é
  processado pelo serviço do navegador.
- Android: o WebView não tem Web Speech → plugin
  `@capacitor-community/speech-recognition` (reconhecedor nativo do Android,
  gratuito).

---

## 8. Hospedagem e custo

| Peça | Serviço | Custo |
|---|---|---|
| Web/PWA | Cloudflare Pages (ou GitHub Pages) | grátis |
| Banco, Auth, Functions, cron | Supabase Free | grátis |
| IA | Gemini API, nível gratuito | grátis (ver limites) |
| Calendário | Google Calendar API | grátis |
| Web Push | push service do navegador | grátis |
| Android | Capacitor + Android Studio, sem Play Store | grátis |

---

## 9. Fases

| Fase | Entrega | Dados |
|---|---|---|
| 1 | Onboarding, captura (texto+voz), `interpret`, agendador + testes, proposta/aprovação, telas Hoje/Semana/Caixa/Config | IndexedDB local; Supabase só para a Edge Function |
| 2 | Login Google, tabelas + RLS, sync, Google Calendar leitura/escrita, Web Push | nuvem |
| 3 | Build Android, notificações nativas com check-in e remarcação, guia de bateria e alarmes exatos | — |
| 4 | Modo cozinha (receitas, lista de compras, duração = preparo) e rotinas recorrentes | — |
