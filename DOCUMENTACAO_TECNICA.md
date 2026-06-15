# Transcript Mass Pro V1 — Documentação Técnica e Arquitetura

Este documento serve como um **guia técnico e de arquitetura** para que qualquer Inteligência Artificial ou desenvolvedor possa entender rapidamente como o projeto foi estruturado, como funciona e como realizar manutenções ou melhorias futuras.

---

## 1. Visão Geral

O **Transcript Mass Pro V1** é uma aplicação web de página única (SPA - Single Page Application) focada em ajudar criadores de conteúdo a:
1. Extrair transcrições de vídeos de um canal do YouTube em massa.
2. Analisar o estilo, nicho e tom do canal utilizando Inteligência Artificial.
3. Gerar roteiros originais e em massa baseados no estilo analisado.

O projeto foi construído **sem frameworks pesados** (sem React, Vue, ou Node.js no backend). É uma aplicação 100% Vanilla (HTML, CSS, JS) que roda inteiramente no navegador do cliente (Client-Side) utilizando APIs de terceiros.

---

## 2. Estrutura de Arquivos

O projeto consiste em três arquivos principais:

*   **`index.html`**: A estrutura e interface da aplicação. Contém os 3 módulos principais divididos em abas (Extração, Geração, Resultados) e modais (Configurações, Visualização de Transcrição).
*   **`style.css`**: Todo o design system. Construído com CSS puro (Variáveis CSS na raiz `:root`), utilizando uma estética Dark Premium com efeitos de Glassmorphism. O design é totalmente responsivo e utiliza CSS Grid e Flexbox extensivamente.
*   **`app.js`**: O "cérebro" da aplicação. Contém toda a lógica de estado, controle de UI (abas e modais), integração com a API do YouTube (via proxies e RSS) e comunicação com a API do OpenRouter para a IA.

**Bibliotecas Externas Utilizadas:**
*   **JSZip** (via CDN): Utilizado para compactar e baixar múltiplos roteiros em um único arquivo `.zip`.
*   **Google Fonts**: Fonte *Inter* para a tipografia do sistema.

---

## 3. Gerenciamento de Estado (State Management)

No `app.js`, o estado da aplicação é gerenciado por um objeto global chamado `state`. Isso permite que dados fluam facilmente entre diferentes funções sem a necessidade de passar parâmetros complexos.

```javascript
const state = {
  settings: {
    apiKey: '', // Chave do OpenRouter (armazenada no localStorage)
    analysisModel: 'anthropic/claude-3-haiku', // ou 'custom'
    analysisModelCustom: '',
    generationModel: 'anthropic/claude-3.5-sonnet', // ou 'custom'
    generationModelCustom: '',
  },
  extraction: {
    url: '', // URL fornecida pelo usuário (canal, @handle ou playlist)
    quantity: 10,
    languages: ['pt', 'pt-BR', 'en'],
    videos: [], // Lista de objetos com info dos vídeos (id, title, thumbnail)
    transcripts: [], // Transcrições extraídas com sucesso
  },
  analysis: {
    briefing: null, // JSON retornado pela IA analisando o canal
    masterPrompt: '', // Prompt gerado automaticamente a partir do briefing
    images: [], // Thumbnails enviadas manualmente pelo usuário (Base64)
  },
  scripts: {
    size: 2000,
    count: 5,
    results: [], // Lista de roteiros gerados {id, title, text, wordCount}
    generating: false,
  },
};
```

---

## 4. Integrações e APIs (Como a mágica acontece)

A ferramenta se comunica com serviços externos. Como a aplicação roda no Client-Side (navegador), as requisições sofrem com políticas de CORS. Aqui está como as integrações foram resolvidas:

### 4.1. Extração do YouTube
O YouTube não possui uma API oficial e gratuita para extrair transcrições via JavaScript no Client-Side. Para contornar isso, o `app.js` usa uma abordagem de "Tenda" (Múltiplas estratégias de fallback):

1.  **Descoberta de Vídeos:**
    *   Tenta usar instâncias públicas do **Invidious** (uma interface alternativa open-source do YouTube) para buscar vídeos de canais ou playlists. As URLs do Invidious estão na constante `INVIDIOUS_INSTANCES`.
    *   *Fallback:* Usa o feed RSS do próprio YouTube (`/feeds/videos.xml?channel_id=`) para pegar os vídeos mais recentes.
2.  **Extração de Transcrição:**
    *   *Estratégia 1:* Faz o fetch da página do vídeo (`watch?v=`) passando pelo proxy, procura pelo JSON de `playerCaptionsTracklistRenderer` embutido na página, pega o XML da legenda e formata em texto puro.
    *   *Estratégia 2:* Tenta a API direta oculta `youtube.com/api/timedtext`.
    *   *Estratégia 3:* Tenta acessar as legendas via endpoint do Invidious (`/api/v1/captions/`).
3.  **CORS Proxy Público:** Como requisições diretas a partir de um HTML local ou domínio diferente para o YouTube falhariam, a ferramenta utiliza o proxy gratuito da `allorigins.win` (definido na constante `CORS_PROXY`).

### 4.2. Integração com IA (OpenRouter)
A análise dos canais e a geração dos roteiros são feitas via **OpenRouter** (`https://openrouter.ai/api/v1/chat/completions`). O OpenRouter atua como um agregador, permitindo que a aplicação se conecte a diversos modelos (Claude, GPT, Gemini, Llama) usando apenas uma API Key.
*   **Análise do Canal:** A aplicação envia amostras das transcrições (os 5 primeiros vídeos) e pede que a IA retorne um objeto **JSON** estruturado com nicho, tom, estilo, etc.
*   **Geração do Prompt Mestre:** Uma segunda chamada é feita para criar a instrução principal com base no JSON da análise.
*   **Geração de Roteiros:** As gerações rodam em um loop `for` sequencial (para não estourar rate limits), enviando o Prompt Mestre, contexto do canal e a instrução de quantidade de palavras.

---

## 5. Fluxo da Interface (UI/UX)

1.  **Navegação em Abas:** As tabs são controladas ocultando/exibindo as divs `.tab-panel` (Controlado pela função `switchTab`).
2.  **Helpers do DOM:** Em vez de usar jQuery, o arquivo `app.js` possui mini-helpers para manipulação de DOM (`$()` atua como `getElementById` com fallback para `querySelector`, e `$$()` atua como `querySelectorAll`).
3.  **Persistência:** A API Key e os modelos escolhidos são salvos em `localStorage` através das funções `saveSettings()` e `loadSettings()`.
4.  **Notificações (Toasts):** A função `toast(msg, type)` cria pequenos popups dinâmicos para avisos de sucesso ou erro.

---

## 6. Como modificar ou estender (Para a próxima IA)

Se você é uma Inteligência Artificial e foi solicitada a adicionar uma funcionalidade, considere o seguinte:

*   **Adicionar novos Modelos de IA:** Basta adicionar um objeto na array `MODELS` (linha ~19 do `app.js`).
*   **Problemas com CORS / Youtube:** Se a extração começar a falhar constantemente, o YouTube provavelmente bloqueou os IPs da `allorigins.win`. Será necessário alterar a variável `CORS_PROXY` para um servidor proxy backend próprio ou outro proxy público (ex: `corsproxy.io`).
*   **Novos Campos no Formulário de Roteiro:**
    1. Crie o novo input HTML na Tab 2 (`index.html`).
    2. Adicione a variável no estado `state.scripts`.
    3. Atualize a função `handleGenerate()` no `app.js` para ler esse valor.
    4. Concatene a nova variável de forma lógica dentro de `buildScriptPrompt()`.
*   **CSS e Design:** Todo o tema base está em `:root` no começo de `style.css`. Mudanças nas variáveis `--bg-` ou `--primary` vão refletir globalmente.

---
*Gerado automaticamente para documentação e manutenção. A aplicação é totalmente Client-Side, sem dependência de banco de dados.*
