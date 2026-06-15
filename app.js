/* ============================================================
   TRANSCRIPT MASS PRO V1 — Application Logic
   ============================================================ */

'use strict';

// ================================================================
// CONSTANTS
// ================================================================
// CORREÇÃO: Trocando o CORS_PROXY para um mais estável.
// O 'https://api.allorigins.win' é muito instável e causa erros 408/Load failed.
// 'https://corsproxy.io/?' é uma alternativa pública mais robusta.
const CORS_PROXY     = 'https://corsproxy.io/?';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const INVIDIOUS_INSTANCES = [
  'https://invidious.privacydev.net',
  'https://inv.tux.pizza',
  'https://yt.cdaut.de',
  'https://invidious.io',
];

const MODELS = [
  { id: 'anthropic/claude-3-haiku',        label: 'Claude 3 Haiku (Rápido · Barato)' },
  { id: 'anthropic/claude-3.5-sonnet',     label: 'Claude 3.5 Sonnet (Equilibrado)' },
  { id: 'anthropic/claude-3-opus',         label: 'Claude 3 Opus (Mais Poderoso)' },
  { id: 'openai/gpt-4o-mini',              label: 'GPT-4o Mini (Rápido)' },
  { id: 'openai/gpt-4o',                   label: 'GPT-4o (Poderoso)' },
  { id: 'google/gemini-flash-1.5',         label: 'Gemini Flash 1.5 (Rápido)' },
  { id: 'google/gemini-pro-1.5',           label: 'Gemini Pro 1.5' },
  { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B (Gratuito)' },
  { id: 'mistralai/mixtral-8x7b-instruct', label: 'Mixtral 8x7B (Gratuito)' },
  { id: 'custom', label: 'Outro (Digitar manualmente)' },
];

// ================================================================
// STATE
// ================================================================
const state = {
  settings: {
    apiKey:          '',
    analysisModel:   'anthropic/claude-3-haiku',
    analysisModelCustom: '',
    generationModel: 'anthropic/claude-3.5-sonnet',
    generationModelCustom: '',
  },
  extraction: {
    url:         '',
    quantity:    10,
    languages:   ['pt', 'pt-BR', 'en'],
    videos:      [],
    transcripts: [],
  },
  analysis: {
    briefing:    null,
    masterPrompt: '',
    images:      [], // user-uploaded base64 images
  },
  scripts: {
    size:    2000,
    count:   5,
    results: [],
    generating: false,
  },
};

// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  initTabs();
  initExtractionForm();
  initAnalysisSection();
  initScriptForm();
  initSettings();
  initModals();
  renderApiStatus();
});

// ================================================================
// SETTINGS — load / save
// ================================================================
function loadSettings() {
  try {
    const saved = localStorage.getItem('tmp_v1_settings');
    if (saved) Object.assign(state.settings, JSON.parse(saved));
  } catch (_) {}
}

function saveSettings() {
  localStorage.setItem('tmp_v1_settings', JSON.stringify(state.settings));
}

function renderApiStatus() {
  const dot   = $('#api-status-dot');
  const label = $('#api-status-label');
  if (state.settings.apiKey) {
    dot.className   = 'api-dot connected';
    label.textContent = 'API Conectada';
  } else {
    dot.className   = 'api-dot error';
    label.textContent = 'Sem API Key';
  }
}

// ================================================================
// TABS
// ================================================================
function initTabs() {
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(id) {
  $$('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === id);
    b.setAttribute('aria-selected', b.dataset.tab === id);
  });
  $$('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'tab-' + id);
  });
}

// ================================================================
// EXTRACTION FORM
// ================================================================
function initExtractionForm() {
  // Quantity button group
  $$('[data-qty]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-qty]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.qty === 'other') {
        show('qty-input');
      } else {
        hide('qty-input');
        state.extraction.quantity = parseInt(btn.dataset.qty);
      }
    });
  });
  $('[data-qty="10"]').classList.add('active');

  $('qty-input').addEventListener('change', e => {
    state.extraction.quantity = parseInt(e.target.value) || 10;
  });

  // Language chips
  $$('.lang-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const selected = !chip.classList.contains('selected');
      chip.classList.toggle('selected', selected);
      chip.setAttribute('aria-pressed', selected);
      const code = chip.dataset.lang;
      if (selected) {
        if (!state.extraction.languages.includes(code))
          state.extraction.languages.push(code);
      } else {
        state.extraction.languages = state.extraction.languages.filter(l => l !== code);
      }
    });
  });

  // Pre-select default langs
  $$('.lang-chip').forEach(chip => {
    if (['pt', 'pt-BR', 'en'].includes(chip.dataset.lang)) {
      chip.classList.add('selected');
      chip.setAttribute('aria-pressed', 'true');
    }
  });

  // Extract button
  $('btn-extract').addEventListener('click', handleExtract);
}

// ================================================================
// EXTRACT HANDLER
// ================================================================
async function handleExtract() {
  const url = $('channel-url').value.trim();
  if (!url) { toast('Por favor, insira uma URL do canal ou playlist.', 'error'); return; }

  state.extraction.url         = url;
  state.extraction.videos      = [];
  state.extraction.transcripts = [];

  const btn = $('btn-extract');
  setBtn(btn, true, '<div class="spinner"></div> Extraindo...');

  $('transcript-list').innerHTML = '';
  show('transcripts-section');
  hide('analysis-section');
  $('analysis-section').classList.remove('visible');

  try {
    toast('Buscando vídeos do canal...', 'info');

    const qty = $('qty-input').classList.contains('hidden')
      ? state.extraction.quantity
      : (parseInt($('qty-input').value) || 10);

    const videos = await fetchChannelVideos(url, qty);
    if (!videos.length) throw new Error('Nenhum vídeo encontrado para este canal.');

    state.extraction.videos = videos;

    // Extract transcripts sequentially
    const list = $('transcript-list');
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const el = createTranscriptEl(i + 1, video, 'loading');
      list.appendChild(el);

      try {
        const text = await fetchTranscript(video.id, state.extraction.languages);
        video.transcript = text;
        video.wordCount  = countWords(text);
        updateTranscriptEl(el, i + 1, video, 'success');
        state.extraction.transcripts.push({ ...video });
      } catch (err) {
        video.error      = err.message;
        video.transcript = '';
        updateTranscriptEl(el, i + 1, video, 'error');
      }
    }

    const ok = state.extraction.transcripts.filter(t => t.transcript).length;
    if (ok > 0) {
      $('analysis-section').classList.add('visible');
      loadThumbnails(videos);
      toast(`${ok} transcrição(ões) extraída(s) com sucesso!`, 'success');
    } else {
      toast('Não foi possível extrair transcrições. Verifique se os vídeos têm legendas.', 'error');
    }

  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  } finally {
    setBtn(btn, false, '<span>⚡</span> Analisar Canal e Extrair Transcrições');
  }
}

// ================================================================
// YOUTUBE — Channel Videos
// ================================================================
async function fetchChannelVideos(rawUrl, count) {
  // Parse URL
  let channelId = null;
  let handle    = null;
  let playlistId = null;

  const plMatch  = rawUrl.match(/[?&]list=([^&]+)/);
  const cidMatch = rawUrl.match(/\/channel\/(UC[a-zA-Z0-9_\-]{20,})/);
  const hMatch   = rawUrl.match(/\/@([^\/\?]+)/);

  if (plMatch)  playlistId = plMatch[1];
  if (cidMatch) channelId  = cidMatch[1];
  if (hMatch)   handle     = hMatch[1];

  // CORREÇÃO: Adicionando validação para aceitar @handle sem a URL completa
  // Se a URL for apenas "@handle", o hMatch não encontra, então tratamos aqui.
  if (!channelId && !handle && !playlistId) {
      const simpleHandleMatch = rawUrl.match(/^@([^\/\?]+)$/);
      if (simpleHandleMatch) {
          handle = simpleHandleMatch[1];
      }
  }

  if (!channelId && !handle && !playlistId)
    throw new Error('URL inválida. Use @handle, /channel/UCxxx ou uma playlist do YouTube.');

  if (playlistId) return getVideosFromPlaylist(playlistId, count);
  return getVideosFromChannel(handle, channelId, count);
}

async function getVideosFromChannel(handle, channelId, count) {
  // 1. Try Invidious
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      let cid = channelId;

      if (!cid && handle) {
        // Resolve handle → channelId via Invidious
        const res  = await proxyFetch(`${base}/api/v1/channels/@${handle}`);
        if (res?.authorId) cid = res.authorId;
      }

      if (!cid) continue;

      const res = await proxyFetch(`${base}/api/v1/channels/${cid}/videos?fields=videoId,title`);
      const arr = Array.isArray(res) ? res : res?.videos || [];
      if (arr.length > 0) {
        return arr.slice(0, count).map(v => videoObj(v.videoId, v.title));
      }
    } catch (_) { /* try next */ }
  }

  // 2. Fallback: YouTube RSS feed
  try {
    let cid = channelId;

    if (!cid && handle) {
      // Fetch channel page to get channelId
      const html = await proxyRaw(`https://www.youtube.com/@${handle}`);
      const m = html.match(/"channelId":"(UC[a-zA-Z0-9_\-]{20,})"/);
      if (m) cid = m[1];
    }

    if (!cid) throw new Error('ID do canal não encontrado.');

    const xml = await proxyRaw(`https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const entries = Array.from(doc.querySelectorAll('entry'));

    return entries.slice(0, count).map(e => {
      const id    = (e.querySelector('videoId')?.textContent || '').trim() ||
                    (e.querySelector('id')?.textContent || '').split(':').pop();
      const title = (e.querySelector('title')?.textContent || 'Sem título').trim();
      return videoObj(id, title);
    }).filter(v => v.id);
  } catch (err) {
    throw new Error('Não foi possível buscar vídeos: ' + err.message);
  }
}

async function getVideosFromPlaylist(playlistId, count) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await proxyFetch(`${base}/api/v1/playlists/${playlistId}`);
      const vids = res?.videos || [];
      if (vids.length) return vids.slice(0, count).map(v => videoObj(v.videoId, v.title));
    } catch (_) {}
  }
  throw new Error('Não foi possível carregar a playlist.');
}

function videoObj(id, title) {
  return {
    id,
    title:     title || 'Sem título',
    thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
    url:       `https://www.youtube.com/watch?v=${id}`,
    transcript: '',
    wordCount:  0,
  };
}

// ================================================================
// YOUTUBE — Transcripts
// ================================================================
async function fetchTranscript(videoId, preferredLangs) {
  const langs = preferredLangs.filter(l => l !== 'auto');

  // Strategy 1: YouTube embedded JSON → timedtext API
  try {
    const html = await proxyRaw(`https://www.youtube.com/watch?v=${videoId}`);

    // Extract captions JSON from page
    const capMatch = html.match(/"captions"\s*:\s*(\{"playerCaptionsTracklistRenderer":\{[^}]+(?:\{[^}]*\})*[^}]*\}\})/);
    if (capMatch) {
      let capJson;
      try { capJson = JSON.parse(capMatch[1].replace(/\\u0026/g, '&').replace(/\\u003d/g, '=')); } catch (_) {}

      const tracks = capJson?.playerCaptionsTracklistRenderer?.captionTracks || [];
      let track = null;
      for (const l of langs) {
        track = tracks.find(t => t.languageCode === l || t.languageCode.startsWith(l.split('-')[0]));
        if (track) break;
      }
      if (!track && tracks.length) track = tracks[0];

      if (track?.baseUrl) {
        const xml = await proxyRaw(track.baseUrl);
        const text = parseCaptionXml(xml);
        if (text.length > 60) return text;
      }
    }
  } catch (_) {}

  // Strategy 2: Direct timedtext for known languages
  for (const lang of [...langs, 'en', 'pt']) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`;
      const raw = await proxyRaw(url);
      const data = JSON.parse(raw);
      const text = (data.events || [])
        .flatMap(e => (e.segs || []).map(s => s.utf8 || ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 60) return text;
    } catch (_) {}
  }

  // Strategy 3: Invidious captions endpoint
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const capList = await proxyFetch(`${base}/api/v1/captions/${videoId}`);
      const captions = capList?.captions || [];
      for (const lang of [...langs, 'en', 'pt', '']) {
        const cap = captions.find(c => !lang || c.language_code === lang || c.language_code.startsWith(lang));
        if (cap) {
          const xml = await proxyRaw(`${base}${cap.url}`);
          const text = parseCaptionXml(xml);
          if (text.length > 60) return text;
        }
      }
    } catch (_) {}
  }

  throw new Error('Transcrição não disponível (vídeo sem legendas ou acesso negado)');
}

function parseCaptionXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(doc.querySelectorAll('text, p'))
    .map(el => (el.textContent || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ================================================================
// YOUTUBE — Thumbnails
// ================================================================
function loadThumbnails(videos) {
  const grid = $('thumbnails-grid');
  grid.innerHTML = '';
  videos.slice(0, 6).forEach(v => {
    const div = document.createElement('div');
    div.className = 'thumbnail-item';
    div.title = v.title;
    div.innerHTML = `<img src="${v.thumbnail}" alt="${escHtml(v.title)}" loading="lazy"
      onerror="this.src='https://img.youtube.com/vi/${v.id}/default.jpg'">`;
    grid.appendChild(div);
  });
}

// ================================================================
// TRANSCRIPT ITEM UI
// ================================================================
function createTranscriptEl(num, video, status) {
  const el = document.createElement('div');
  el.className = 'transcript-item';
  el.dataset.vid = video.id;
  el.innerHTML = transcriptItemHTML(num, video, status);
  return el;
}

function updateTranscriptEl(el, num, video, status) {
  el.innerHTML = transcriptItemHTML(num, video, status);
}

function transcriptItemHTML(num, video, status) {
  const maps = {
    loading: { cls: 'badge-loading', txt: '⟳ Extraindo...' },
    success: { cls: 'badge-success', txt: `✓ ${fmt(video.wordCount)} palavras` },
    error:   { cls: 'badge-error',   txt: '✗ Sem transcrição' },
  };
  const s = maps[status] || maps.loading;
  const viewBtn = status === 'success' && video.transcript
    ? `<button class="btn btn-secondary btn-sm" onclick="openTranscript('${video.id}')">→ Ver</button>`
    : '';

  return `
    <span class="transcript-num">${num}.</span>
    <div class="transcript-info">
      <div class="transcript-title">${escHtml(video.title)}</div>
      <div class="transcript-preview">${video.transcript ? escHtml(video.transcript.slice(0, 100)) + '…' : (video.error || 'Aguardando...')}</div>
    </div>
    <span class="transcript-badge ${s.cls}">${s.txt}</span>
    ${viewBtn}
  `;
}

// ================================================================
// VIEW TRANSCRIPT MODAL
// ================================================================
function openTranscript(videoId) {
  const video = state.extraction.videos.find(v => v.id === videoId);
  if (!video?.transcript) return;
  $('view-modal-title').textContent = video.title;
  $('view-modal-body').textContent  = video.transcript;
  $('view-modal-wc').textContent    = fmt(video.wordCount) + ' palavras';
  $('view-modal').classList.add('open');
}

// ================================================================
// ANALYSIS SECTION
// ================================================================
function initAnalysisSection() {
  const dropZone  = $('drop-zone');
  const fileInput = $('upload-images');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleImageUpload([...e.dataTransfer.files]);
  });
  fileInput.addEventListener('change', e => handleImageUpload([...e.target.files]));

  $('btn-analyze').addEventListener('click', handleAnalyze);

  $('btn-use-prompt').addEventListener('click', () => {
    const p = $('master-prompt-output').value.trim();
    if (!p) { toast('Gere o Prompt Mestre primeiro.', 'error'); return; }
    $('master-prompt-input').value = p;
    state.scripts.masterPrompt     = p;
    switchTab('scripts');
    toast('Prompt Mestre carregado! Configure e gere seus roteiros.', 'success');
  });
}

function handleImageUpload(files) {
  const imgs = files.filter(f => f.type.startsWith('image/'));
  imgs.forEach(f => {
    const reader = new FileReader();
    reader.onload = e => {
      state.analysis.images.push({ src: e.target.result, name: f.name });
      renderUploadedImages();
    };
    reader.readAsDataURL(f);
  });
}

function renderUploadedImages() {
  $('uploaded-images-grid').innerHTML = state.analysis.images.map((img, i) => `
    <div class="thumbnail-item" style="position:relative;">
      <img src="${img.src}" alt="${escHtml(img.name)}">
      <button onclick="removeUploadedImage(${i})"
        style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.75);border:none;
               color:#fff;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:11px;
               display:flex;align-items:center;justify-content:center;">✕</button>
    </div>
  `).join('');
}

function removeUploadedImage(i) {
  state.analysis.images.splice(i, 1);
  renderUploadedImages();
}

// ================================================================
// CHANNEL ANALYSIS — AI
// ================================================================
async function handleAnalyze() {
  if (!state.settings.apiKey) {
    toast('Configure sua API Key nas ⚙️ Configurações primeiro.', 'error');
    $('settings-modal').classList.add('open');
    loadSettingsForm();
    return;
  }

  const valid = state.extraction.transcripts.filter(t => t.transcript);
  if (!valid.length) { toast('Nenhuma transcrição disponível para análise.', 'error'); return; }

  const btn = $('btn-analyze');
  setBtn(btn, true, '<div class="spinner"></div> Analisando...');
  show('analysis-progress');
  hide('briefing-section');

  try {
    setProgress('analysis', 10, 'Preparando transcrições...');

    const sample = valid.slice(0, 5).map((t, i) =>
      `=== Vídeo ${i + 1}: "${t.title}" ===\n${t.transcript.slice(0, 1600)}`
    ).join('\n\n');

    setProgress('analysis', 30, 'Enviando para análise da IA...');

    const briefingPrompt = `Analise este canal do YouTube com base nas transcrições abaixo e retorne um briefing completo.

TRANSCRIÇÕES:
${sample}

Responda SOMENTE com um JSON válido, sem markdown, nesta estrutura exata:
{
  "nicho": "string",
  "tom_narrativo": "string",
  "estilo_visual": "string",
  "estrutura_roteiro": "string",
  "publico_alvo": "string",
  "idioma_principal": "string",
  "palavras_chave": ["string"],
  "estilo_narrativo": "string com 2-3 frases descrevendo o estilo de escrita",
  "cta_sugerida": "string",
  "prompts_negativos": "string com instruções do que evitar"
}`;

    const modelToUse = state.settings.analysisModel === 'custom' ? state.settings.analysisModelCustom : state.settings.analysisModel;
    const raw = await callOpenRouter(
      briefingPrompt,
      modelToUse,
      'Você é especialista em análise de canais do YouTube e criação de conteúdo. Retorne apenas JSON válido.'
    );

    setProgress('analysis', 60, 'Processando briefing...');

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('A IA não retornou JSON válido. Tente novamente.');
    const briefing = JSON.parse(jsonMatch[0]);
    state.analysis.briefing = briefing;

    setProgress('analysis', 78, 'Gerando Prompt Mestre...');

    const masterPrompt = await buildMasterPrompt(briefing);
    state.analysis.masterPrompt = masterPrompt;

    setProgress('analysis', 100, '✅ Análise completa!');

    // Render briefing
    $('briefing-card').innerHTML = briefingHTML(briefing);
    show('briefing-section');

    // Fill master prompt textarea
    $('master-prompt-output').value = masterPrompt;

    // Pre-fill scripts tab
    $('theme-input').value             = briefing.nicho || '';
    $('master-prompt-input').value     = masterPrompt;
    $('cta-input').value               = briefing.cta_sugerida || '';
    $('negative-prompts-input').value  = briefing.prompts_negativos || '';

    // Pre-select output language
    const lang = (briefing.idioma_principal || '').toLowerCase();
    const sel  = $('output-language');
    for (const opt of sel.options) {
      if (opt.value.toLowerCase().includes(lang.split(' ')[0]) || lang.includes(opt.value.toLowerCase().split(' ')[0])) {
        sel.value = opt.value;
        break;
      }
    }

    toast('Análise completa! Prompt Mestre gerado.', 'success');

  } catch (err) {
    toast('Erro na análise: ' + err.message, 'error');
  } finally {
    setBtn(btn, false, '🔬 Analisar Canal com IA');
    setTimeout(() => hide('analysis-progress'), 2500);
  }
}

async function buildMasterPrompt(briefing) {
  const prompt = `Com base no briefing abaixo de um canal do YouTube, crie um Prompt Mestre detalhado para geração de roteiros que capture perfeitamente o estilo deste canal.

BRIEFING:
- Nicho: ${briefing.nicho}
- Tom Narrativo: ${briefing.tom_narrativo}
- Estilo Visual: ${briefing.estilo_visual}
- Estrutura de Roteiro: ${briefing.estrutura_roteiro}
- Público-Alvo: ${briefing.publico_alvo}
- Estilo Narrativo: ${briefing.estilo_narrativo}
- Palavras-chave: ${(briefing.palavras_chave || []).join(', ')}
- Idioma Principal: ${briefing.idioma_principal}

O Prompt Mestre deve:
1. Definir claramente o tone e estilo narrativo do canal
2. Especificar a estrutura exata do roteiro (gancho, desenvolvimento, clímax, CTA)
3. Incluir instruções sobre vocabulário, ritmo e linguagem
4. Definir como criar ganchos iniciais impactantes
5. Especificar o ritmo narrativo e fluxo emocional
6. Ter entre 250–450 palavras
7. Estar no idioma: ${briefing.idioma_principal}
8. NÃO mencionar nomes de canais específicos
9. Ser escrito em 1ª pessoa do imperativo (instruindo a IA diretamente)

Retorne APENAS o prompt, sem explicações, títulos ou formatação extra.`;

  const modelToUse = state.settings.analysisModel === 'custom' ? state.settings.analysisModelCustom : state.settings.analysisModel;
  return callOpenRouter(
    prompt,
    modelToUse,
    'Você é especialista em criar prompts para geração de roteiros de YouTube. Crie prompts detalhados, eficazes e precisos.'
  );
}

function briefingHTML(b) {
  const kw = (b.palavras_chave || []).map(k => `<span class="lang-chip selected" style="cursor:default;font-size:0.73rem;">${escHtml(k)}</span>`).join('');
  return `
    <div class="section-title" style="margin-bottom:14px;">
      📋 Briefing do Canal
      <span class="section-title-badge">IA</span>
    </div>
    <div class="briefing-grid">
      <div class="briefing-item"><div class="briefing-item-label">🎯 Nicho</div><div class="briefing-item-value">${escHtml(b.nicho || '—')}</div></div>
      <div class="briefing-item"><div class="briefing-item-label">🎭 Tom Narrativo</div><div class="briefing-item-value">${escHtml(b.tom_narrativo || '—')}</div></div>
      <div class="briefing-item"><div class="briefing-item-label">🎨 Estilo Visual</div><div class="briefing-item-value">${escHtml(b.estilo_visual || '—')}</div></div>
      <div class="briefing-item"><div class="briefing-item-label">📝 Estrutura dos Roteiros</div><div class="briefing-item-value">${escHtml(b.estrutura_roteiro || '—')}</div></div>
      <div class="briefing-item"><div class="briefing-item-label">👥 Público-Alvo</div><div class="briefing-item-value">${escHtml(b.publico_alvo || '—')}</div></div>
      <div class="briefing-item"><div class="briefing-item-label">🌐 Idioma Principal</div><div class="briefing-item-value">${escHtml(b.idioma_principal || '—')}</div></div>
    </div>
    ${kw ? `<div style="margin-top:14px;"><div class="briefing-item-label">🔑 Palavras-Chave</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">${kw}</div></div>` : ''}
    ${b.estilo_narrativo ? `<div class="briefing-item" style="margin-top:12px;"><div class="briefing-item-label">✍️ Estilo Narrativo</div><div class="briefing-item-value">${escHtml(b.estilo_narrativo)}</div></div>` : ''}
  `;
}

// ================================================================
// SCRIPT FORM
// ================================================================
function initScriptForm() {
  // Size group
  $$('[data-size]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-size]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.size === 'other') {
        show('size-input');
      } else {
        hide('size-input');
        state.scripts.size = parseInt(btn.dataset.size);
      }
    });
  });
  $('[data-size="2000"]').classList.add('active');

  $('size-input').addEventListener('input', e => { state.scripts.size = parseInt(e.target.value) || 2000; });

  // Count group
  $$('[data-count]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-count]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.count === 'other') {
        show('count-input');
      } else {
        hide('count-input');
        state.scripts.count = parseInt(btn.dataset.count);
      }
    });
  });
  $('[data-count="5"]').classList.add('active');

  $('count-input').addEventListener('input', e => { state.scripts.count = parseInt(e.target.value) || 5; });

  $('btn-generate').addEventListener('click', handleGenerate);
}

// ================================================================
// SCRIPT GENERATION
// ================================================================
async function handleGenerate() {
  if (!state.settings.apiKey) {
    toast('Configure sua API Key nas ⚙️ Configurações.', 'error');
    $('settings-modal').classList.add('open');
    loadSettingsForm();
    return;
  }

  const masterPrompt = $('master-prompt-input').value.trim();
  const theme        = $('theme-input').value.trim();
  const cta          = $('cta-input').value.trim();
  const negative     = $('negative-prompts-input').value.trim();
  const language     = $('output-language').value;

  const sizeEl  = $('size-input');
  const countEl = $('count-input');
  const size  = (!sizeEl.classList.contains('hidden') && sizeEl.value)  ? parseInt(sizeEl.value)  : state.scripts.size;
  const count = (!countEl.classList.contains('hidden') && countEl.value) ? parseInt(countEl.value) : state.scripts.count;

  if (!masterPrompt && !theme) {
    toast('Adicione um Prompt Mestre ou Tema/Nicho antes de gerar.', 'error');
    return;
  }

  state.scripts.generating = true;
  state.scripts.results    = [];

  const btn = $('btn-generate');
  setBtn(btn, true, '<div class="spinner"></div> Gerando Roteiros...');

  switchTab('results');
  hide('results-empty');
  show('results-progress');
  hide('download-all-bar');
  $('scripts-list').innerHTML = '';

  // Build transcript context
  const validT = state.extraction.transcripts.filter(t => t.transcript);
  const context = validT.length
    ? validT.slice(0, 3).map(t => t.transcript.slice(0, 900)).join('\n\n---\n\n')
    : '';

  for (let i = 0; i < count; i++) {
    setProgress('results', Math.round((i / count) * 95), `Gerando roteiro ${i + 1} de ${count}...`);

    try {
      const prompt = buildScriptPrompt({ masterPrompt, theme, cta, negative, size, language, context, num: i + 1 });
      const modelToUse = state.settings.generationModel === 'custom' ? state.settings.generationModelCustom : state.settings.generationModel;
      const script = await callOpenRouter(
        prompt,
        modelToUse,
        `Você é um roteirista profissional de YouTube. Crie roteiros originais, envolventes e no idioma: ${language}. Escreva APENAS o roteiro, sem comentários ou metadados.`
      );

      const result = { id: Date.now() + i, title: `Roteiro ${i + 1}`, text: script, wordCount: countWords(script) };
      state.scripts.results.push(result);
      appendScriptCard(result, i + 1);
    } catch (err) {
      toast(`Erro no roteiro ${i + 1}: ${err.message}`, 'error');
    }
  }

  setProgress('results', 100, `✅ ${state.scripts.results.length} roteiro(s) gerado(s)!`);

  if (state.scripts.results.length) {
    show('download-all-bar');
    toast(`${state.scripts.results.length} roteiro(s) gerado(s)!`, 'success');
  }

  setBtn(btn, false, '<span>🚀</span> Gerar Roteiros em Massa');
  state.scripts.generating = false;
}

function buildScriptPrompt({ masterPrompt, theme, cta, negative, size, language, context, num }) {
  let p = '';
  if (masterPrompt) p += masterPrompt + '\n\n';
  if (theme)        p += `TEMA/NICHO ESPECÍFICO: ${theme}\n\n`;

  p += `INSTRUÇÕES ADICIONAIS:
- Idioma de saída: ${language}
- Tamanho alvo: aproximadamente ${size} palavras
- Roteiro número ${num} — deve ser COMPLETAMENTE ORIGINAL e DIFERENTE dos anteriores
- Crie um título impactante para o roteiro no início`;

  if (context) {
    p += `\n\nEXEMPLOS DE ESTILO DO CANAL (use APENAS como referência de estilo — NÃO copie o conteúdo):
${context.slice(0, 1400)}`;
  }

  if (cta) p += `\n\nCHAMADA PARA AÇÃO (inclua organicamente no final):\n${cta}`;
  if (negative) p += `\n\nREGRAS — NÃO FAZER:\n${negative}`;

  p += '\n\nEscreva APENAS o roteiro completo.';
  return p;
}

// ================================================================
// SCRIPT CARD UI
// ================================================================
function appendScriptCard(result, num) {
  const list = $('scripts-list');
  const el   = document.createElement('div');
  el.className = 'script-item';
  el.id        = `script-${result.id}`;
  el.innerHTML = `
    <div class="script-item-header" onclick="toggleScript('${result.id}')">
      <div class="script-num">${num}</div>
      <div class="script-meta">
        <div class="script-title">${escHtml(result.title)}</div>
        <div class="script-stats" id="stats-${result.id}">${fmt(result.wordCount)} palavras</div>
      </div>
      <div class="script-actions">
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); dlScript('${result.id}','txt')">⬇ TXT</button>
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); dlScript('${result.id}','rtf')">⬇ DOCX</button>
        <span class="chevron" id="chev-${result.id}">›</span>
      </div>
    </div>
    <div class="script-body" id="body-${result.id}">
      <div class="script-text" id="text-${result.id}">${escHtml(result.text)}</div>
      <div class="script-footer">
        <button class="btn btn-secondary btn-sm" onclick="toggleEdit('${result.id}')">✏️ Editar</button>
        <button class="btn btn-secondary btn-sm" onclick="dlScript('${result.id}','txt')">⬇ TXT</button>
        <button class="btn btn-secondary btn-sm" onclick="dlScript('${result.id}','rtf')">⬇ DOCX</button>
      </div>
    </div>
  `;
  list.appendChild(el);

  // Auto-open first result
  if (num === 1) toggleScript(result.id);
}

function toggleScript(id) {
  const body  = $('body-' + id);
  const chev  = $('chev-' + id);
  const open  = body.classList.toggle('expanded');
  chev.style.transform  = open ? 'rotate(90deg)' : 'rotate(0deg)';
  chev.style.transition = 'transform 0.2s ease';
}

function toggleEdit(id) {
  const el = $('text-' + id);
  const editing = el.contentEditable === 'true';
  el.contentEditable = editing ? 'false' : 'true';
  if (!editing) {
    el.focus();
    toast('Modo edição ativado. Clique em "Editar" novamente para salvar.', 'info');
  } else {
    const r = state.scripts.results.find(x => String(x.id) === String(id));
    if (r) {
      r.text      = el.textContent;
      r.wordCount = countWords(r.text);
      const statsEl = $('stats-' + id);
      if (statsEl) statsEl.textContent = fmt(r.wordCount) + ' palavras';
    }
    toast('Alterações salvas.', 'success');
  }
}

function dlScript(id, fmt_) {
  const r = state.scripts.results.find(x => String(x.id) === String(id));
  if (!r) return;
  const textEl = $('text-' + id);
  const text   = textEl ? textEl.textContent : r.text;

  if (fmt_ === 'txt') {
    dlFile(text, `${r.title}.txt`, 'text/plain');
  } else {
    // RTF (opens in Word as DOCX)
    const safe = text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\par\n');
    const rtf  = `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman\\fprq2\\fcharset0 Times New Roman;}}{\\colortbl ;\\red0\\green0\\blue0;}\\f0\\fs24\\pard\\sa200\\sl276\\slmult1 {\\b ${r.title}}\\par\\par ${safe}}`;
    dlFile(rtf, `${r.title}.rtf`, 'application/rtf');
  }
}

async function downloadAllScripts() {
  if (!state.scripts.results.length) return;
  toast('Preparando ZIP...', 'info');

  try {
    const zip = new JSZip();
    state.scripts.results.forEach((r, i) => {
      const textEl = $('text-' + r.id);
      const text   = textEl ? textEl.textContent : r.text;
      zip.file(`Roteiro_${String(i + 1).padStart(2, '0')}_${r.title.replace(/\s+/g, '_')}.txt`, text);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    dlFile(blob, 'Roteiros_TranscriptMassPro.zip', 'application/zip');
    toast('ZIP baixado!', 'success');
  } catch (_) {
    // Fallback: individual downloads
    state.scripts.results.forEach(r => dlScript(r.id, 'txt'));
  }
}

function dlFile(content, name, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ================================================================
// OPENROUTER API
// ================================================================
async function callOpenRouter(userPrompt, model, systemPrompt = '') {
  if (!state.settings.apiKey) throw new Error('API Key não configurada.');

  const messages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    { role: 'user', content: userPrompt },
  ];

  const resp = await fetch(OPENROUTER_API, {
    method: 'POST',
    headers: {
      'Content-Type':   'application/json',
      'Authorization':  `Bearer ${state.settings.apiKey}`,
      'HTTP-Referer':   window.location.href,
      'X-Title':        'Transcript Mass Pro V1',
    },
    body: JSON.stringify({
      model:       model || state.settings.generationModel,
      messages,
      temperature: 0.82,
      max_tokens:  4096,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenRouter error ${resp.status}`);
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Resposta vazia da API.');
  return text;
}

// ================================================================
// SETTINGS MODAL
// ================================================================
function initSettings() {
  $('btn-settings').addEventListener('click', () => {
    loadSettingsForm();
    $('settings-modal').classList.add('open');
  });

  $('settings-close').addEventListener('click', () => $('settings-modal').classList.remove('open'));

  $('settings-modal').addEventListener('click', e => {
    if (e.target === $('settings-modal')) $('settings-modal').classList.remove('open');
  });

  $('analysis-model-select').addEventListener('change', e => {
    e.target.value === 'custom' ? show('analysis-model-custom') : hide('analysis-model-custom');
  });
  $('generation-model-select').addEventListener('change', e => {
    e.target.value === 'custom' ? show('generation-model-custom') : hide('generation-model-custom');
  });

  $('btn-save-settings').addEventListener('click', () => {
    state.settings.apiKey          = $('api-key-input').value.trim();
    state.settings.analysisModel   = $('analysis-model-select').value;
    state.settings.analysisModelCustom = $('analysis-model-custom').value.trim();
    state.settings.generationModel = $('generation-model-select').value;
    state.settings.generationModelCustom = $('generation-model-custom').value.trim();
    saveSettings();
    renderApiStatus();
    $('settings-modal').classList.remove('open');
    toast('Configurações salvas!', 'success');
  });

  $('btn-test-api').addEventListener('click', testApiKey);
}

function loadSettingsForm() {
  $('api-key-input').value = state.settings.apiKey;

  const opts = MODELS.map(m => `<option value="${m.id}">${m.label}</option>`).join('');
  $('analysis-model-select').innerHTML   = opts;
  $('generation-model-select').innerHTML = opts;
  $('analysis-model-select').value   = state.settings.analysisModel;
  $('generation-model-select').value = state.settings.analysisModel;

  $('analysis-model-custom').value   = state.settings.analysisModelCustom || '';
  $('generation-model-custom').value = state.settings.generationModelCustom || '';

  if (state.settings.analysisModel === 'custom') show('analysis-model-custom'); else hide('analysis-model-custom');
  if (state.settings.generationModel === 'custom') show('generation-model-custom'); else hide('generation-model-custom');
}

async function testApiKey() {
  const key = $('api-key-input').value.trim();
  if (!key) { toast('Insira uma API Key primeiro.', 'error'); return; }

  const btn = $('btn-test-api');
  setBtn(btn, true, 'Testando...');

  try {
    const r = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    if (r.ok) toast('✅ Conexão com OpenRouter bem-sucedida!', 'success');
    else throw new Error('API Key inválida ou sem permissão.');
  } catch (e) {
    toast('❌ ' + e.message, 'error');
  } finally {
    setBtn(btn, false, '🔗 Testar Conexão');
  }
}

// ================================================================
// MODALS
// ================================================================
function initModals() {
  $('view-modal-close').addEventListener('click', () => $('view-modal').classList.remove('open'));
  $('view-modal').addEventListener('click', e => { if (e.target === $('view-modal')) $('view-modal').classList.remove('open'); });

  $('btn-copy-transcript').addEventListener('click', () => {
    const text = $('view-modal-body').textContent;
    navigator.clipboard.writeText(text).then(() => toast('Transcrição copiada!', 'success'));
  });
}

// ================================================================
// TOAST
// ================================================================
function toast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: '💬' };
  const el    = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${escHtml(msg)}</span>`;
  $('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.opacity   = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, 4200);
}

// ================================================================
// PROGRESS HELPER
// ================================================================
function setProgress(scope, pct, msg) {
  const fill = $(`${scope}-progress-fill`);
  const msgEl = $(`${scope}-progress-msg`);
  if (fill)  fill.style.width = pct + '%';
  if (msgEl) msgEl.innerHTML  = `<span class="status-dot"></span> ${escHtml(msg)}`;

  const pctEl = $(`${scope}-progress-pct`);
  if (pctEl) pctEl.textContent = pct + '%';
}

// ================================================================
// PROXY HELPERS
// ================================================================
async function proxyFetch(url) {
  // CORREÇÃO: Adicionando o prefixo 'https://' se o URL do proxy não tiver
  // Isso é necessário para o corsproxy.io, que espera a URL completa do destino.
  const targetUrl = url.startsWith('http') ? url : `https://${url}`;
  const r = await fetch(CORS_PROXY + encodeURIComponent(targetUrl));
  if (!r.ok) throw new Error(`Proxy error ${r.status}`);
  const data = await r.json();
  // CORREÇÃO: corsproxy.io retorna o conteúdo diretamente, não dentro de 'contents'
  // Também pode retornar JSON ou texto puro, então tentamos JSON.parse
  let content = data;
  if (typeof data === 'string') {
      try { content = JSON.parse(data); } catch (_) {}
  }
  if (!content) throw new Error('Empty proxy response');
  return content;
}

async function proxyRaw(url) {
  // CORREÇÃO: Adicionando o prefixo 'https://' se o URL do proxy não tiver
  const targetUrl = url.startsWith('http') ? url : `https://${url}`;
  const r = await fetch(CORS_PROXY + encodeURIComponent(targetUrl));
  if (!r.ok) throw new Error(`Proxy error ${r.status}`);
  // CORREÇÃO: corsproxy.io retorna o conteúdo diretamente como texto
  const data = await r.text();
  return data || '';
}

// ================================================================
// UTILITIES
// ================================================================
function $$(sel) { return [...document.querySelectorAll(sel)]; }
function $(id)   { return document.getElementById(id) || document.querySelector(id); }

function show(id) { const el = $(id); if (el) el.classList.remove('hidden'); }
function hide(id) { const el = $(id); if (el) el.classList.add('hidden'); }

function setBtn(btn, disabled, html) {
  btn.disabled   = disabled;
  btn.innerHTML  = html;
}

function countWords(str) {
  return (str || '').trim().split(/\s+/).filter(w => w.length > 0).length;
}

function fmt(n) {
  return (n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}

// ================================================================
// GLOBAL (called from HTML onclick attributes)
// ================================================================
window.openTranscript      = openTranscript;
window.toggleScript        = toggleScript;
window.toggleEdit          = toggleEdit;
window.dlScript            = dlScript;
window.downloadAllScripts  = downloadAllScripts;
window.removeUploadedImage = removeUploadedImage;
