# Agenda IA

Organizador semanal pessoal com IA (web + Android).

- **O que falta para ligar tudo:** [docs/CONFIGURAR.md](docs/CONFIGURAR.md)
- Plano de arquitetura: [docs/ARQUITETURA.md](docs/ARQUITETURA.md)
- Modelo de dados: [supabase/migrations/20261010000000_init.sql](supabase/migrations/20261010000000_init.sql)

## Estrutura

| Pasta | O quê |
|---|---|
| `app/` | React + Vite + TS (PWA). Dados locais em IndexedDB na Fase 1 |
| `supabase/functions/_shared/scheduler/` | Agendador determinístico (usado pelo app e pelas functions) |
| `supabase/functions/_shared/llm/` | Módulo de LLM trocável (Gemini hoje) |
| `supabase/functions/interpret/` | Edge Function: texto → tarefas em JSON |
| `supabase/functions/cook/` | Receitas saudáveis (modo cozinha) |
| `supabase/functions/gcal-sync/`, `google-connect/` | Google Calendar (leitura e escrita) |
| `supabase/functions/push-dispatch/` | Web Push no computador (pg_cron a cada minuto) |
| `app/android/` | App Android (Capacitor) com o plugin nativo `AgendaNative` |

## Rodar localmente

```bash
cd app
npm install
npm test            # testes do agendador
cp .env.example .env.local   # preencha a URL/anon key do Supabase
npm run dev
```

Edge Function local (precisa do Deno e de `GEMINI_API_KEY` no ambiente):

```bash
deno run --allow-net --allow-env --allow-read supabase/functions/interpret/index.ts
# e no app: VITE_SUPABASE_URL=http://localhost:8000
```

## Publicar

- **Edge Function**: `supabase functions deploy interpret --project-ref pqvyqimddzkauyrnbxra`
  com os segredos `GEMINI_API_KEY` (obrigatório), `LLM_MODEL`, `LLM_FALLBACK_MODEL`
  e `LLM_DAILY_CAP` (opcionais).
- **App web**: o workflow `.github/workflows/pages.yml` publica no GitHub Pages a
  cada push. A chave anon vem da variável de repositório `SUPABASE_ANON_KEY`.

Nunca coloque chaves secretas (Gemini, service role, senha do banco) no
repositório: ele é público.
