const askButton = document.getElementById('askButton');
const clearButton = document.getElementById('clearButton');
const exportButton = document.getElementById('exportButton');
const urlInput = document.getElementById('urlInput');
const questionInput = document.getElementById('questionInput');
const summaryModeInput = document.getElementById('summaryMode');
const showSourcesInput = document.getElementById('showSources');
const autoScrollInput = document.getElementById('autoScroll');
const chatArea = document.getElementById('chatArea');
const statusMessage = document.getElementById('statusMessage');
const agentLog = document.getElementById('agentLog');
const sourcePanel = document.getElementById('sourcePanel');
const STORAGE_KEY = 'setu-agent-session';
const assistantName = 'Setu';

window.addEventListener('load', () => {
  restoreSession();
  if (!chatArea.innerHTML.trim()) {
    addChatMessage('assistant', assistantName, 'Hello! I am Setu. Paste URLs and ask your question, and I will analyze the pages and answer with reasoning, sources, and a clear summary.');
  }
});

askButton.addEventListener('click', handleAgentRequest);
clearButton.addEventListener('click', clearConversation);
exportButton.addEventListener('click', exportConversation);

async function handleAgentRequest() {
  const rawUrls = urlInput.value.trim();
  const question = questionInput.value.trim();
  const summaryMode = summaryModeInput.checked;

  addChatMessage('user', 'You', rawUrls ? `Question: ${question || 'Summarize pages'}\nURLs:\n${rawUrls}` : `Question: ${question}`);
  clearAgentLog();
  setStatus('Preparing your request...');
  addAgentLog('Agent', 'Planning', 'Setu will fetch the page content, extract the important details, and then create an answer based on the request.');

  if (!rawUrls) {
    setStatus('Please add at least one URL.', true);
    addAgentLog('Agent', 'Validation', 'No URLs were provided. Setu needs at least one page to read.');
    return;
  }

  const urls = rawUrls.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  addAgentLog('Tool', 'WebFetcher', `Fetching content from ${urls.length} URL(s)...`);
  setStatus('Fetching website content...');

  const siteSummaries = [];
  for (const url of urls) {
    addAgentLog('Tool', 'WebFetcher', `Loading ${url}`);
    const result = await fetchWebsiteText(url);
    siteSummaries.push(result);
    if (result.error) {
      addAgentLog('Tool Result', 'WebFetcher', `Failed to fetch ${url}: ${result.error}`);
    } else {
      addAgentLog('Tool Result', 'TextExtractor', `Extracted ${result.text.length} characters from ${url}.`);
    }
  }

  const validTexts = siteSummaries.filter((item) => item.text).map((item) => item.text);
  updateSourcePanel(siteSummaries);

  if (!validTexts.length) {
    setStatus('No readable content was extracted.', true);
    addAgentLog('Agent', 'Troubleshooting', 'No valid content was available to analyze.');
    addChatMessage('assistant', assistantName, 'I could not read any of the provided pages. Please check the URLs or try different websites.');
    saveSession();
    return;
  }

  addAgentLog('Agent', 'Reasoning', 'I have page text ready. Now I will analyze the content and build an answer that fits your query.');
  setStatus('Analyzing content...');

  const answer = createAnswer(question, validTexts, summaryMode);
  addAgentLog('Agent', 'Conclusion', 'Setu synthesized the most relevant information and generated the answer.');

  setStatus('Setu has completed the analysis.');
  addChatMessage('assistant', assistantName, answer);
  saveSession();
}

function addChatMessage(role, label, text) {
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.innerHTML = `<span class="label">${escapeHtml(label)}</span><div>${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
  chatArea.appendChild(message);
  if (autoScrollInput.checked) {
    message.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
}

function addAgentLog(role, label, text) {
  const step = document.createElement('div');
  step.className = 'step';
  step.innerHTML = `<span class="tool-label">${escapeHtml(label)}</span><div class="tool-output">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
  agentLog.appendChild(step);
  if (autoScrollInput.checked) {
    step.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
}

function clearAgentLog() {
  agentLog.innerHTML = '';
}

function updateSourcePanel(summaries) {
  if (!showSourcesInput.checked) {
    sourcePanel.innerHTML = '';
    return;
  }

  sourcePanel.innerHTML = '<h3>Source details</h3>' + summaries.map((item) => {
    const status = item.error ? 'error' : 'success';
    const metadata = item.error ? item.error : `${item.wordCount} words · ${item.title || 'No title'}`;
    return `<div class="source-row"><div><div class="source-title">${escapeHtml(item.url)}</div><div class="source-meta">${escapeHtml(metadata)}</div></div><div><span class="badge ${status}">${status === 'success' ? 'Loaded' : 'Error'}</span></div></div>`;
  }).join('');
}

async function fetchWebsiteText(url) {
  const normalizedUrl = normalizeUrl(url);
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(normalizedUrl)}`;

  try {
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`Unable to fetch page: ${response.statusText}`);
    }
    const html = await response.text();
    const text = extractReadableText(html);
    const metadata = extractPageMetadata(html);
    return {
      url: normalizedUrl,
      text: text.trim(),
      title: metadata.title,
      description: metadata.description,
      wordCount: countWords(text),
    };
  } catch (error) {
    return { url, error: error.message };
  }
}

function normalizeUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `https://${url}`;
}

function extractPageMetadata(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const title = doc.querySelector('title')?.innerText?.trim() || '';
  const description = doc.querySelector('meta[name="description"]')?.content?.trim() || '';
  return { title, description };
}

function extractReadableText(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const selectors = ['script', 'style', 'noscript', 'iframe', 'header', 'footer', 'nav', 'svg', 'canvas'];
  selectors.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((node) => node.remove());
  });

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let text = '';
  let node;
  while ((node = walker.nextNode())) {
    const parentName = node.parentElement?.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'iframe', 'svg', 'canvas'].includes(parentName)) continue;
    const cleaned = node.nodeValue.replace(/\s+/g, ' ').trim();
    text += cleaned ? ` ${cleaned}` : '';
  }

  return text.replace(/\s{2,}/g, ' ').trim();
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function createAnswer(question, texts, summaryMode) {
  const joinedText = texts.join(' ');
  const sentences = splitSentences(joinedText);
  const summary = summarizeText(joinedText);
  const query = question.trim();

  if (summaryMode || !query) {
    addAgentLog('Agent', 'Responding', 'Summary mode is enabled, so I am producing a concise overview of the pages.');
    return `Summary:\n${summary}`;
  }

  const keywords = extractKeywords(query);
  const relevant = sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword));
  });

  if (!relevant.length) {
    addAgentLog('Agent', 'Fallback', 'No direct answer was found, so I am returning a general summary instead.');
    return `I could not find a direct match for your question. Here is a summary of the content:\n${summary}`;
  }

  const answer = composeAnswer(query, relevant, texts.length);
  const facts = buildKeyFacts(relevant);
  return `${answer}\n\nKey facts:\n${facts}`;
}

function summarizeText(text) {
  const sentences = splitSentences(text);
  const top = sentences.slice(0, 5);
  return top.join(' ');
}

function buildKeyFacts(sentences) {
  return sentences.slice(0, 5).map((sentence) => `• ${sentence}`).join('\n');
}

function extractKeywords(question) {
  return question
    .toLowerCase()
    .replace(/[?\.!,:;]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !['about', 'what', 'when', 'where', 'how', 'why', 'which', 'who', 'that', 'this', 'with', 'from', 'your', 'page'].includes(word));
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function composeAnswer(query, relevantSentences, siteCount) {
  const excerpt = relevantSentences.slice(0, 4).join(' ');
  return `Answer:\n${excerpt}\n\n(From ${siteCount} page${siteCount === 1 ? '' : 's'}.)`;
}

function clearConversation() {
  chatArea.innerHTML = '';
  agentLog.innerHTML = '';
  sourcePanel.innerHTML = '';
  addChatMessage('assistant', assistantName, 'Conversation cleared. Paste your URLs and ask your next question whenever you are ready.');
  setStatus('Ready to assist.');
  localStorage.removeItem(STORAGE_KEY);
}

function exportConversation() {
  const chatText = Array.from(chatArea.querySelectorAll('.message')).map((message) => {
    const role = message.classList.contains('assistant') ? assistantName : 'You';
    const content = message.querySelector('div')?.innerText || '';
    return `${role}: ${content}`;
  }).join('\n\n');

  const logText = Array.from(agentLog.querySelectorAll('.step')).map((step) => {
    const label = step.querySelector('.tool-label')?.innerText || 'Log';
    const content = step.querySelector('.tool-output')?.innerText || '';
    return `${label}: ${content}`;
  }).join('\n\n');

  const exportText = `Setu AI Agent Conversation\n\n${chatText}\n\nAgent log:\n${logText}`;
  navigator.clipboard.writeText(exportText).then(() => {
    setStatus('Conversation exported to clipboard.');
  }).catch(() => {
    setStatus('Unable to export conversation. Copying is not supported in this browser.', true);
  });
}

function saveSession() {
  const state = {
    chat: chatArea.innerHTML,
    log: agentLog.innerHTML,
    sources: sourcePanel.innerHTML,
    urls: urlInput.value,
    question: questionInput.value,
    summaryMode: summaryModeInput.checked,
    showSources: showSourcesInput.checked,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    chatArea.innerHTML = saved.chat || '';
    agentLog.innerHTML = saved.log || '';
    sourcePanel.innerHTML = saved.sources || '';
    urlInput.value = saved.urls || '';
    questionInput.value = saved.question || '';
    summaryModeInput.checked = saved.summaryMode || false;
    showSourcesInput.checked = saved.showSources !== false;
    if (chatArea.innerHTML.trim()) {
      setStatus('Restored previous session.');
    }
  } catch (error) {
    console.error('Failed to restore session', error);
  }
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.className = isError ? 'status error' : 'status';
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
