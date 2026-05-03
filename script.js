const askButton = document.getElementById('askButton');
const urlInput = document.getElementById('urlInput');
const questionInput = document.getElementById('questionInput');
const chatArea = document.getElementById('chatArea');
const statusMessage = document.getElementById('statusMessage');
const agentLog = document.getElementById('agentLog');

askButton.addEventListener('click', async () => {
  const rawUrls = urlInput.value.trim();
  const question = questionInput.value.trim();

  clearAgentLog();
  setStatus('Preparing your request…');
  addChatMessage('user', 'You', `Question: ${question}\nURLs:\n${rawUrls}`);
  addAgentLog('Agent', 'Planning', 'I will gather page content from the provided URLs, extract relevant information, and generate a helpful answer.');

  if (!rawUrls || !question) {
    setStatus('Please add at least one URL and a question.', true);
    addAgentLog('Agent', 'Validation', 'The input is incomplete. Both URLs and a question are required.');
    return;
  }

  const urls = rawUrls.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  setStatus('Setu is reading the websites...');
  addChatMessage('assistant', 'Setu', 'I’m gathering the page content now and preparing to analyze it.');
  addAgentLog('Tool', 'WebFetcher', `Fetching content from ${urls.length} URL(s).`);

  try {
    const siteSummaries = [];
    for (const url of urls) {
      addAgentLog('Tool', 'WebFetcher', `Loading ${url}`);
      const result = await fetchWebsiteText(url);
      siteSummaries.push(result);
      if (result.error) {
        addAgentLog('Tool Result', 'WebFetcher', `Failed to fetch ${url}: ${result.error}`);
      } else {
        addAgentLog('Tool Result', 'TextExtractor', `Extracted ${result.text.length} characters of text from ${url}.`);
      }
    }

    const validTexts = siteSummaries.filter((item) => item.text).map((item) => item.text);
    addAgentLog('Agent', 'Reasoning', 'I have the extracted text. Now I will analyze the content and determine what is most relevant to your question.');

    let responseText;
    if (!validTexts.length) {
      responseText = 'I could not fetch readable content from any of the provided pages. Please check the URLs or try other pages.';
      setStatus('Unable to fetch page text.', true);
      addAgentLog('Agent', 'Troubleshooting', 'No valid content was extracted, so I could not generate an answer.');
    } else {
      const answer = createAnswer(question, validTexts);
      responseText = `Here is what I found from the pages I read:\n\n${answer}`;
      setStatus('Setu has completed the analysis.');
      addAgentLog('Agent', 'Conclusion', 'I synthesized the most relevant information from the extracted content and formed an answer.');
    }

    addChatMessage('assistant', 'Setu', responseText);
    addChatSummary(siteSummaries);
  } catch (err) {
    setStatus('Setu encountered an error while processing your request.', true);
    addAgentLog('Agent', 'Error', 'An unexpected problem occurred while fetching or analyzing the pages.');
    addChatMessage('assistant', 'Setu', 'I had trouble accessing the websites. Please try again or use different URLs.');
    console.error(err);
  }
});

function addChatMessage(role, label, text) {
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.innerHTML = `<span class="label">${escapeHtml(label)}</span><div>${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
  chatArea.appendChild(message);
  message.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function addAgentLog(role, label, text) {
  const step = document.createElement('div');
  step.className = 'step';
  step.innerHTML = `<span class="tool-label">${escapeHtml(label)}</span><div class="tool-output">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
  agentLog.appendChild(step);
  step.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function clearAgentLog() {
  agentLog.innerHTML = '';
}

function addChatSummary(summaries) {
  const summaryText = summaries
    .map((item) => {
      if (item.error) {
        return `<strong>${escapeHtml(item.url)}</strong>: <span class="error">${escapeHtml(item.error)}</span>`;
      }
      return `<strong>${escapeHtml(item.url)}</strong>: content fetched successfully.`;
    })
    .join('<br>');

  const summaryMessage = document.createElement('div');
  summaryMessage.className = 'summary';
  summaryMessage.innerHTML = `<span class="label">Setu</span><div>${summaryText}</div>`;
  chatArea.appendChild(summaryMessage);
  summaryMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.className = isError ? 'status error' : 'status';
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
    return { url: normalizedUrl, text: text.trim() };
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

function extractReadableText(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const elementsToRemove = [...doc.querySelectorAll('script, style, noscript, iframe, header, footer, nav')];
  elementsToRemove.forEach((node) => node.remove());

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let text = '';
  let node;
  while ((node = walker.nextNode())) {
    const parentName = node.parentElement?.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'iframe'].includes(parentName)) continue;
    text += ` ${node.nodeValue.replace(/\s+/g, ' ').trim()}`;
  }

  return text.replace(/\s{2,}/g, ' ').trim();
}

function createAnswer(question, texts) {
  const joinedText = texts.join(' ');
  const sentences = splitSentences(joinedText);
  const query = question.toLowerCase();
  const keywords = extractKeywords(question);

  const relevant = sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword));
  });

  if (relevant.length) {
    return composeAnswer(query, relevant, texts.length);
  }

  return composeAnswer(query, sentences.slice(0, 4), texts.length);
}

function extractKeywords(question) {
  return question
    .toLowerCase()
    .replace(/[\?\.!,]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !['about', 'what', 'when', 'where', 'how', 'why', 'which', 'who', 'the', 'and', 'for', 'with', 'from'].includes(word));
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function composeAnswer(query, relevantSentences, siteCount) {
  const excerpt = relevantSentences.slice(0, 3).join(' ');
  let answer = excerpt;

  if (/^(what|who|where|when|why|how)/.test(query)) {
    answer = relevantSentences.length ? excerpt : 'I found related content but couldn\'t pinpoint a direct answer from the available pages.';
  } else {
    answer = relevantSentences.length ? excerpt : 'I read the pages and did not find a clear answer from the content.';
  }

  return `${answer} (${siteCount} page${siteCount === 1 ? '' : 's'} used)`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
