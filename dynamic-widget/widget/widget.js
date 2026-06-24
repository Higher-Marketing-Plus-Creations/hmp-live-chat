(function () {
  'use strict';

  const WIDGET_SELECTOR = 'script[data-client-id]';
  const WEBHOOK_URL = 'https://hmp.app.n8n.cloud/webhook/hmp-conversation-engine';
  const FALLBACK_MESSAGE = 'Sorry, I could not reach the assistant right now. Please try again.';

  if (document.getElementById('hmp-widget-root')) return;

  const widgetScript = findWidgetScript();
  const clientId = widgetScript && widgetScript.dataset.clientId;
  if (!widgetScript || !clientId) {
    console.error('[HMP Widget] A data-client-id is required.');
    return;
  }

  const config = getConfig(clientId);
  const sessionId = getSessionId(clientId);
  loadStyles(widgetScript);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountWidget, { once: true });
  } else {
    mountWidget();
  }

  function findWidgetScript() {
    if (document.currentScript && document.currentScript.dataset.clientId) return document.currentScript;
    return Array.from(document.querySelectorAll(WIDGET_SELECTOR))
      .find((script) => /(?:^|\/)widget\.js(?:\?|$)/.test(script.src)) || null;
  }

  function getConfig(id) {
    const dataset = widgetScript.dataset;
    return {
      clientId: id,
      assistantName: dataset.assistantName || 'HMP Assistant',
      welcomeMessage: dataset.welcomeMessage || 'Hi there! How can I assist you today?',
      themeColor: dataset.themeColor || '#050816',
      fallbackMessage: dataset.fallbackMessage || FALLBACK_MESSAGE
    };
  }

  function loadStyles(script) {
    if (document.querySelector('link[data-hmp-widget-styles]')) return;
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('widget.css', script.src).href;
    stylesheet.dataset.hmpWidgetStyles = 'true';
    document.head.appendChild(stylesheet);
  }

  function createSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const bytes = window.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return `hmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getSessionId(id) {
    const storageKey = `hmp-session-id:${id}`;
    try {
      const storedId = window.localStorage.getItem(storageKey);
      if (storedId) return storedId;
      const newId = createSessionId();
      window.localStorage.setItem(storageKey, newId);
      return newId;
    } catch (error) {
      console.warn('[HMP Widget] localStorage is unavailable; using a temporary session.', error);
      return createSessionId();
    }
  }

  function getPageContext() {
    const heading = document.querySelector('h1');
    const meaningfulParagraph = Array.from(document.querySelectorAll('main p')).find((paragraph) => {
      const text = paragraph.textContent.trim();
      return text.length >= 40 && paragraph.offsetParent !== null;
    });
    const headingText = heading ? heading.textContent.trim() : '';
    const paragraphText = meaningfulParagraph ? meaningfulParagraph.textContent.trim() : '';
    return {
      currentUrl: window.location.href,
      pageTitle: document.title,
      pageSummary: [headingText, paragraphText].filter(Boolean).join(' - ')
    };
  }

  function mountWidget() {
    if (document.getElementById('hmp-widget-root')) return;
    const root = document.createElement('div');
    root.id = 'hmp-widget-root';
    root.className = 'hmp-widget-root';
    root.style.setProperty('--hmp-widget-theme', config.themeColor);
    root.innerHTML = `
      <section class="hmp-widget-panel" id="hmp-widget-panel" role="dialog" aria-modal="false" aria-labelledby="hmp-widget-title" hidden>
        <header class="hmp-widget-header">
          <div class="hmp-widget-avatar" aria-hidden="true">S</div>
          <div class="hmp-widget-header-copy"><h2 id="hmp-widget-title"></h2><p><span class="hmp-widget-status-dot" aria-hidden="true"></span>Online to help</p></div>
          <button class="hmp-widget-close" type="button" aria-label="Close chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </header>
        <div class="hmp-widget-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
        <div class="hmp-widget-typing" role="status" aria-label="Assistant is typing" hidden><span></span><span></span><span></span></div>
        <form class="hmp-widget-form">
          <label class="hmp-widget-sr-only" for="hmp-widget-input">Type your message</label>
          <textarea id="hmp-widget-input" class="hmp-widget-input" rows="1" maxlength="2000" placeholder="Type your message..." required></textarea>
          <button class="hmp-widget-send" type="submit" aria-label="Send message"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>
        </form>
        <p class="hmp-widget-powered">Powered by HMP Assistant</p>
      </section>
      <button class="hmp-widget-launcher" type="button" aria-expanded="false" aria-controls="hmp-widget-panel" aria-label="Open chat">
        <svg class="hmp-widget-chat-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4v8z"/></svg>
        <svg class="hmp-widget-launcher-close" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>`;
    document.body.appendChild(root);

    const panel = root.querySelector('.hmp-widget-panel');
    const launcher = root.querySelector('.hmp-widget-launcher');
    const closeButton = root.querySelector('.hmp-widget-close');
    const messages = root.querySelector('.hmp-widget-messages');
    const form = root.querySelector('.hmp-widget-form');
    const input = root.querySelector('.hmp-widget-input');
    const sendButton = root.querySelector('.hmp-widget-send');
    const typing = root.querySelector('.hmp-widget-typing');

    root.querySelector('#hmp-widget-title').textContent = config.assistantName;
    launcher.setAttribute('aria-label', `Open chat with ${config.assistantName}`);
    addMessage(messages, config.welcomeMessage, 'assistant');
    launcher.addEventListener('click', () => setPanelOpen(panel.hidden));
    closeButton.addEventListener('click', () => setPanelOpen(false));
    form.addEventListener('submit', handleSubmit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    input.addEventListener('input', resizeInput);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) setPanelOpen(false);
    });

    function setPanelOpen(isOpen) {
      panel.hidden = !isOpen;
      root.classList.toggle('hmp-widget-is-open', isOpen);
      launcher.setAttribute('aria-expanded', String(isOpen));
      launcher.setAttribute('aria-label', isOpen ? 'Close chat' : `Open chat with ${config.assistantName}`);
      if (isOpen) window.setTimeout(() => input.focus(), 50);
      else launcher.focus();
    }

    function resizeInput() {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 100)}px`;
    }

    async function handleSubmit(event) {
      event.preventDefault();
      const message = input.value.trim();
      if (!message || input.disabled) return;
      addMessage(messages, message, 'user');
      input.value = '';
      resizeInput();
      setLoading(true);
      try {
        const response = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, sessionId, message, pageContext: getPageContext() })
        });
        if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
        const data = await response.json();
        if (data.success !== true || typeof data.reply !== 'string' || !data.reply.trim()) {
          throw new Error('Webhook returned an invalid response.');
        }
        addMessage(messages, data.reply.trim(), 'assistant');
      } catch (error) {
        console.error('[HMP Widget] Message request failed.', error);
        addMessage(messages, config.fallbackMessage, 'assistant', true);
      } finally {
        setLoading(false);
        input.focus();
      }
    }

    function setLoading(isLoading) {
      input.disabled = isLoading;
      sendButton.disabled = isLoading;
      typing.hidden = !isLoading;
      if (isLoading) messages.scrollTop = messages.scrollHeight;
    }
  }

  function addMessage(container, text, sender, isError) {
    const row = document.createElement('div');
    const bubble = document.createElement('p');
    row.className = `hmp-widget-message hmp-widget-message-${sender}`;
    if (isError) row.classList.add('hmp-widget-message-error');
    bubble.textContent = text;
    row.appendChild(bubble);
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }

  // Future feature placeholders:
  // - intent selection before starting a conversation
  // - suggested replies based on the assistant response
  // - voice mode for speech input and playback
  // - booking flow with date and time selection
  // - human handoff with conversation history
})();
