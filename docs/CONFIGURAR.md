# O que falta para ligar tudo

Tudo o que dava para fazer sem as suas contas já está pronto e testado (veja
o fim deste arquivo). Os itens abaixo dependem de você, porque envolvem login,
senhas ou o seu celular. Siga na ordem.

---

## 1. Reativar o projeto no Supabase

O plano gratuito **pausa o projeto depois de 7 dias sem uso** (os dados ficam
guardados). O seu foi pausado.

1. Entre em <https://supabase.com/dashboard> e abra o projeto.
2. Toque em **Restore project** e espere ficar verde (1–3 min).

Com o app sincronizando todo dia, ele não deve pausar de novo.

## 2. Token do Supabase (para eu publicar o backend)

O token anterior foi revogado. Preciso de um novo para publicar o que foi feito
(3 migrações, 5 funções, segredos e o login com Google):

1. <https://supabase.com/dashboard/account/tokens> → **Generate new token**.
2. Nome: `agenda-deploy`. Validade: a mais curta que aparecer (ex.: 1 dia).
3. Me mande o token. Depois que eu terminar, você pode revogá-lo.

> Alternativa sem passar o token no chat: no GitHub, em **Settings → Secrets and
> variables → Actions**, crie os segredos `SUPABASE_ACCESS_TOKEN` e
> `SUPABASE_DB_PASSWORD` (senha do banco). O workflow *Backend (Supabase)* passa
> a publicar sozinho a cada mudança.

## 3. Google Cloud: login e Google Calendar

É de graça. Leva uns 10 minutos, melhor no computador.

1. <https://console.cloud.google.com> → crie um projeto chamado **Agenda IA**.
2. **APIs e serviços → Biblioteca** → procure **Google Calendar API** → **Ativar**.
3. **Google Auth Platform** (ou "Tela de consentimento OAuth"):
   - Tipo de usuário: **Externo**. Nome do app: **Agenda IA**. E-mail de suporte: o seu.
   - Em **Público-alvo**, toque em **Publicar app** para ficar **Em produção**.
     Isso é importante: em "Teste", o Google desconecta o Calendar a cada 7 dias.
     Não precisa enviar para verificação: no login vai aparecer "o Google não
     verificou este app"; toque em **Avançado → Ir para Agenda IA**.
4. **Clientes → Criar cliente → Aplicativo da Web**:
   - Origens JavaScript autorizadas: `https://opradopedro.github.io`
   - URIs de redirecionamento autorizados:
     `https://pqvyqimddzkauyrnbxra.supabase.co/auth/v1/callback`
5. Me mande o **ID do cliente** e a **chave secreta do cliente**. Eu configuro no
   Supabase (login) e nas funções (Calendar).

## 4. Instalar o app no Android

1. No celular, abra
   <https://github.com/opradopedro/agenda/releases/tag/android-latest> e baixe
   **agenda.apk**.
2. Abra o arquivo. Se pedir, permita "instalar apps desta fonte" para o navegador.
3. **Se o Android bloquear** dizendo que o desenvolvedor não é verificado (regra
   nova no Brasil desde 30/09/2026), há três saídas gratuitas:
   - **Pelo computador (mais simples):** ative a *Depuração USB* no celular,
     conecte no PC e rode `adb install agenda.apk`. O Google mantém esse caminho
     liberado.
   - **Fluxo avançado do Android:** o próprio Android oferece instalar mesmo
     assim, depois de confirmar os riscos uma vez.
   - **Conta de distribuição limitada** (grátis, até 20 aparelhos) no Android
     Developer Console. Registra o pacote `com.opradopedro.agenda` com a
     impressão SHA-256 da chave, que aparece no log do build *App Android
     (APK)*. Te guio se precisar.
4. Abra o app → **Config → Avisos no Android** e libere tudo:
   Notificações, Alarmes e lembretes, Bateria sem restrições e Tela cheia (só
   para tarefas marcadas como alarme). Use **Testar** para ver um lembrete e um
   alarme chegando com a tela bloqueada.

As próximas versões instalam por cima: é só baixar o `agenda.apk` de novo.

## 5. Notificações no computador

Depois do item 3, entre com o Google no site e vá em **Config → Conta e nuvem →
Notificações neste computador**. Depois toque em **Enviar notificação de teste**.
O Chrome mostra no máximo 2 botões (Terminei e +15 min); tocar na notificação
abre a tela de check-in com os 3.

## 6. Depois que o login funcionar

Me avise que eu travo o acesso à IA só para a sua conta (`ALLOW_ANON=false` e
`ALLOWED_EMAILS` com o seu e-mail). Até lá, as funções de IA aceitam chamadas
sem login (com teto de 100 por dia) para você poder testar o site.

---

## O que já está pronto e testado

| Fase | Situação |
|---|---|
| 1. Captura, IA, agendador, telas | No ar em <https://opradopedro.github.io/agenda/> |
| 2. Login, nuvem, Calendar, Web Push | Código pronto. Testado num Supabase local com dois aparelhos sincronizando, um Google Calendar simulado e um serviço de push simulado. **Falta:** itens 1–3 |
| 3. Android | APK compilado pelo GitHub (release `android-latest`). **Falta:** item 4 |
| 4. Modo cozinha e rotinas | No ar. O modo cozinha só sugere receitas depois do item 2 (a função nova precisa ser publicada) |

Testes automáticos: 32, cobrindo agendador, recorrência, lista de compras,
regras de notificação e o mapa de sincronização.
