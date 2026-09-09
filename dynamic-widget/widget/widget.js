(function () {
  'use strict';

  const WIDGET_SELECTOR = 'script[data-client-id]';
  const WEBHOOK_URL = 'https://hmp.app.n8n.cloud/webhook/hmp-conversation-engine';
  const REALTIME_SESSION_ENDPOINT = 'https://crm.highermarketingplusprojects.com/api/realtime/session';
  const VOICE_CONTEXT_ENDPOINT = 'https://hmp.app.n8n.cloud/webhook/voice-runtime-context';
  const VOICE_TURN_ENDPOINT = 'https://hmp.app.n8n.cloud/webhook/voice-conversation-turn';
  const VOICE_LEAD_PROCESSING_ENDPOINT = 'https://hmp.app.n8n.cloud/webhook/voice-lead-processing';
  const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
  const FALLBACK_MESSAGE = 'Sorry, I could not reach the assistant right now. Please try again.';
  const VOICE_AUDIO_CONSTRAINTS = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: { ideal: 1 }
    }
  };

  if (document.getElementById('hmp-widget-root')) return;

  const widgetScript = findWidgetScript();
  const clientId = widgetScript && widgetScript.dataset.clientId;
  if (!widgetScript || !clientId) {
    console.error('[HMP Widget] A data-client-id is required.');
    return;
  }

  const config = getConfig(clientId);
  const sessionId = getSessionId(clientId);
  const widgetState = getWidgetState(clientId, sessionId);
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
      realtimeSessionEndpoint: dataset.realtimeSessionEndpoint || REALTIME_SESSION_ENDPOINT,
      voiceContextEndpoint: dataset.voiceContextEndpoint || VOICE_CONTEXT_ENDPOINT,
      voiceTurnEndpoint: dataset.voiceTurnEndpoint || VOICE_TURN_ENDPOINT,
      voiceLeadProcessingEndpoint: dataset.voiceLeadProcessingEndpoint || VOICE_LEAD_PROCESSING_ENDPOINT,
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

  function getWidgetState(id, currentSessionId) {
    const storageKey = `hmp-widget-state:${id}:${currentSessionId}`;
    const fallbackState = { storageKey, selectedIntent: null, hasUserMessage: false };
    try {
      const storedState = window.localStorage.getItem(storageKey);
      if (!storedState) return fallbackState;
      const parsedState = JSON.parse(storedState);
      return {
        storageKey,
        selectedIntent: typeof parsedState.selectedIntent === 'string' ? parsedState.selectedIntent : null,
        hasUserMessage: parsedState.hasUserMessage === true
      };
    } catch (error) {
      console.warn('[HMP Widget] Stored widget state is unavailable; using in-memory state.', error);
      return fallbackState;
    }
  }

  function persistWidgetState(state) {
    try {
      window.localStorage.setItem(state.storageKey, JSON.stringify({
        selectedIntent: state.selectedIntent,
        hasUserMessage: state.hasUserMessage
      }));
    } catch (error) {
      console.warn('[HMP Widget] Could not persist widget state.', error);
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
    const assistantPhotoUrl = new URL('../../figma-assets/assistant-photo.jpg', widgetScript.src).href;
    root.id = 'hmp-widget-root';
    root.className = 'hmp-widget-root';
    root.style.setProperty('--hmp-widget-theme', config.themeColor);
    root.style.setProperty('--hmp-widget-avatar-url', `url("${assistantPhotoUrl}")`);
    root.innerHTML = `
      <section class="hmp-widget-panel" id="hmp-widget-panel" role="dialog" aria-modal="false" aria-labelledby="hmp-widget-title" hidden>
        <header class="hmp-widget-header">
          <div class="hmp-widget-avatar" aria-hidden="true"></div>
          <div class="hmp-widget-header-copy"><h2 id="hmp-widget-title"></h2><p><span class="hmp-widget-status-dot" aria-hidden="true"></span><span class="hmp-widget-status-text">Online now</span></p></div>
          <button class="hmp-widget-voice" type="button" aria-label="Start voice conversation" title="Start voice conversation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><path d="M12 19v3"/><path d="M8 22h8"/></svg><span>Talk</span></button>
          <button class="hmp-widget-close" type="button" aria-label="Close chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </header>
        <div class="hmp-widget-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
        <div class="hmp-widget-typing" role="status" aria-label="Assistant is typing" hidden><span></span><span></span><span></span></div>
        <div class="hmp-widget-voice-mode" aria-live="polite" hidden>
          <div class="hmp-widget-voice-visual" aria-hidden="true">
            <span class="hmp-widget-voice-ring"></span>
            <span class="hmp-widget-voice-ring"></span>
            <span class="hmp-widget-voice-core"></span>
            <span class="hmp-widget-voice-bars"><i></i><i></i><i></i><i></i></span>
          </div>
          <div class="hmp-widget-voice-copy">
            <p class="hmp-widget-voice-mode-status">Starting voice...</p>
            <p class="hmp-widget-voice-mode-helper">Keep this window open while you talk.</p>
          </div>
          <div class="hmp-widget-voice-controls">
            <button class="hmp-widget-voice-end" type="button" aria-label="End voice conversation" title="End voice conversation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg><span>Stop</span></button>
            <button class="hmp-widget-voice-back" type="button" aria-label="Back to chat" title="Back to chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4v8z"/></svg></button>
          </div>
        </div>
        <p class="hmp-widget-voice-status" role="status" aria-live="polite" hidden></p>
        <form class="hmp-widget-form">
          <label class="hmp-widget-sr-only" for="hmp-widget-input">Type your message</label>
          <textarea id="hmp-widget-input" class="hmp-widget-input" rows="1" maxlength="2000" placeholder="Type a message..." required></textarea>
          <button class="hmp-widget-send" type="submit" aria-label="Send message"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>
        </form>
        <audio class="hmp-widget-remote-audio" autoplay playsinline hidden></audio>
        <p class="hmp-widget-powered">Powered by HMP Assistant</p>
      </section>
      <button class="hmp-widget-launcher" type="button" aria-expanded="false" aria-controls="hmp-widget-panel" aria-label="Open chat">
        <span class="hmp-widget-launcher-avatar" aria-hidden="true"><span class="hmp-widget-launcher-mic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><path d="M12 19v3"/><path d="M8 22h8"/></svg></span></span>
        <svg class="hmp-widget-launcher-close" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        <span class="hmp-widget-launcher-label">or type</span>
      </button>`;
    document.body.appendChild(root);

    const panel = root.querySelector('.hmp-widget-panel');
    const launcher = root.querySelector('.hmp-widget-launcher');
    const closeButton = root.querySelector('.hmp-widget-close');
    const messages = root.querySelector('.hmp-widget-messages');
    const form = root.querySelector('.hmp-widget-form');
    const input = root.querySelector('.hmp-widget-input');
    const voiceButton = root.querySelector('.hmp-widget-voice');
    const voiceStatus = root.querySelector('.hmp-widget-voice-status');
    const voiceMode = root.querySelector('.hmp-widget-voice-mode');
    const voiceModeStatus = root.querySelector('.hmp-widget-voice-mode-status');
    const voiceModeHelper = root.querySelector('.hmp-widget-voice-mode-helper');
    const voiceEndButton = root.querySelector('.hmp-widget-voice-end');
    const voiceBackButton = root.querySelector('.hmp-widget-voice-back');
    const remoteAudio = root.querySelector('.hmp-widget-remote-audio');
    const sendButton = root.querySelector('.hmp-widget-send');
    const typing = root.querySelector('.hmp-widget-typing');
    const intents = createIntentButtons();
    const intentButtons = Array.from(intents.querySelectorAll('button'));
    let isPanelOpen = false;
    let hasAutoStartedVoice = false;
    let voiceState = 'idle';
    let voicePeerConnection = null;
    let voiceDataChannel = null;
    let voiceMediaStream = null;
    let voiceRemoteStream = null;
    let voicePeerConnectedResolve = null;
    let voiceDataChannelOpenResolve = null;
    let voiceResponseAudioActive = false;
    let remoteAudioPlayAttempts = 0;
    const persistedVoiceTurnIds = new Set();
    const processedVoiceLeadTurnIds = new Set();
    root.insertBefore(intents, launcher);

    root.querySelector('#hmp-widget-title').textContent = config.assistantName;
    launcher.setAttribute('aria-label', `Open chat with ${config.assistantName}`);
    addMessage(messages, config.welcomeMessage, 'assistant');
    updateCTAVisibility();
    launcher.addEventListener('click', handleLauncherClick);
    closeButton.addEventListener('click', () => setPanelOpen(false));
    form.addEventListener('submit', handleSubmit);
    voiceButton.addEventListener('click', handleVoiceButtonClick);
    voiceEndButton.addEventListener('click', () => stopVoiceSession());
    voiceBackButton.addEventListener('click', () => stopVoiceSession());
    intentButtons.forEach((button) => {
      button.addEventListener('click', () => handleIntentSelect(button));
    });
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
    window.addEventListener('beforeunload', () => stopVoiceSession());

    function handleLauncherClick() {
      const shouldOpen = panel.hidden;
      setPanelOpen(shouldOpen);
      if (shouldOpen && !hasAutoStartedVoice) {
        hasAutoStartedVoice = true;
        startVoiceSession();
      }
    }

    function setPanelOpen(isOpen) {
      isPanelOpen = isOpen;
      panel.hidden = !isOpen;
      root.classList.toggle('hmp-widget-is-open', isOpen);
      updateCTAVisibility();
      launcher.setAttribute('aria-expanded', String(isOpen));
      launcher.setAttribute('aria-label', isOpen ? 'Close chat' : `Open chat with ${config.assistantName}`);
      if (isOpen) window.setTimeout(() => input.focus(), 50);
      else {
        stopVoiceSession();
        launcher.focus();
      }
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
      widgetState.hasUserMessage = true;
      persistWidgetState(widgetState);
      updateCTAVisibility();
      input.value = '';
      resizeInput();
      await sendMessage(message, 'chat_message');
    }

    async function handleIntentSelect(button) {
      if (input.disabled) return;
      const message = button.textContent.trim();
      const selectedIntent = button.dataset.intent;
      if (!message || !selectedIntent) return;
      widgetState.selectedIntent = selectedIntent;
      widgetState.hasUserMessage = true;
      persistWidgetState(widgetState);
      setPanelOpen(true);
      addMessage(messages, message, 'user');
      await sendMessage(message, 'intent_selected');
    }

    async function sendMessage(message, eventType) {
      setLoading(true);
      try {
        const response = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            sessionId,
            message,
            selectedIntent: widgetState.selectedIntent,
            eventType,
            pageContext: getPageContext()
          })
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
      intentButtons.forEach((button) => {
        button.disabled = isLoading;
      });
      typing.hidden = !isLoading;
      if (isLoading) messages.scrollTop = messages.scrollHeight;
    }

    async function handleVoiceButtonClick() {
      if (isVoiceSessionActive()) {
        stopVoiceSession();
        return;
      }

      await startVoiceSession();
    }

    async function startVoiceSession() {
      if (isVoiceSessionActive()) return;

      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        setVoiceState('error');
        return;
      }
      if (typeof RTCPeerConnection !== 'function') {
        setVoiceState('error');
        return;
      }

      setVoiceState('connecting');
      console.info('[HMP Widget] Realtime voice connecting.');

      try {
        voiceMediaStream = await navigator.mediaDevices.getUserMedia(VOICE_AUDIO_CONSTRAINTS);
        attemptRemoteAudioPlayback();
        const runtimeContextPromise = getVoiceRuntimeContext();
        const realtimeSession = await getRealtimeSession();
        await connectRealtimeVoice(realtimeSession, runtimeContextPromise);
      } catch (error) {
        console.error('[HMP Widget] Realtime voice setup failed.', {
          message: error instanceof Error ? error.message : 'Unknown error'
        });
        stopVoiceSession('error');
      }
    }

    async function getRealtimeSession() {
      const pageContext = getPageContext();
      const response = await fetch(config.realtimeSessionEndpoint, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: clientId,
          session_id: sessionId,
          current_url: pageContext.currentUrl,
          page_title: pageContext.pageTitle
        })
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data && data.message ? data.message : `Realtime session endpoint returned ${response.status}`);
      }
      if (!data || data.success !== true) {
        throw new Error('Realtime session endpoint returned an unsuccessful response.');
      }
      if (!data.data || typeof data.data.client_secret !== 'string' || !data.data.client_secret) {
        throw new Error('Realtime session endpoint returned an invalid client secret.');
      }

      return {
        clientSecret: data.data.client_secret,
        expiresAt: data.data.expires_at,
        model: data.data.model || 'gpt-realtime'
      };
    }

    async function getVoiceRuntimeContext() {
      const pageContext = getPageContext();
      const response = await fetch(config.voiceContextEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          sessionId,
          currentUrl: pageContext.currentUrl,
          pageTitle: pageContext.pageTitle,
          pageSummary: pageContext.pageSummary
        })
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data && data.message ? data.message : `Voice context endpoint returned ${response.status}`);
      }
      if (!data || data.success !== true) {
        throw new Error('Voice context endpoint returned an unsuccessful response.');
      }
      if (typeof data.instructions !== 'string' || !data.instructions.trim()) {
        throw new Error('Voice context endpoint returned missing instructions.');
      }

      console.info('[HMP Widget] Voice runtime context loaded.');
      return {
        instructions: data.instructions
      };
    }

    async function connectRealtimeVoice(realtimeSession, runtimeContextPromise) {
      // This guard belongs to this new connection, not later UI state changes.
      let hasSentInitialVoiceGreeting = false;
      const peerConnectedPromise = new Promise((resolve) => {
        voicePeerConnectedResolve = resolve;
      });
      const dataChannelOpenPromise = new Promise((resolve) => {
        voiceDataChannelOpenResolve = resolve;
      });
      voicePeerConnection = new RTCPeerConnection();
      voiceRemoteStream = new MediaStream();
      remoteAudio.srcObject = voiceRemoteStream;

      voicePeerConnection.addEventListener('track', (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        stream.getAudioTracks().forEach((track) => {
          voiceRemoteStream.addTrack(track);
        });
        attemptRemoteAudioPlayback(true);
      });

      voicePeerConnection.addEventListener('connectionstatechange', () => {
        const state = voicePeerConnection && voicePeerConnection.connectionState;
        if (state === 'connected') {
          console.info('[HMP Widget] Realtime voice connected.');
          if (voicePeerConnectedResolve) {
            voicePeerConnectedResolve();
            voicePeerConnectedResolve = null;
          }
        } else if (state === 'failed') {
          stopVoiceSession('error', 'Voice connection failed. Please try again.');
        } else if (state === 'disconnected') {
          stopVoiceSession('error', 'Voice disconnected. Please try again.');
        }
      });

      voiceDataChannel = voicePeerConnection.createDataChannel('oai-events');
      voiceDataChannel.addEventListener('open', () => {
        console.info('[HMP Widget] Realtime data channel open.');
        if (voiceDataChannelOpenResolve) {
          voiceDataChannelOpenResolve();
          voiceDataChannelOpenResolve = null;
        }
      });
      voiceDataChannel.addEventListener('close', () => {
        console.info('[HMP Widget] Realtime data channel closed.');
      });
      voiceDataChannel.addEventListener('error', () => {
        console.error('[HMP Widget] Realtime data channel error.');
      });
      voiceDataChannel.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          if (typeof data.type === 'string') {
            console.info('[HMP Widget] Realtime event:', data.type);
            handleRealtimeEvent(data.type);
            handleVoiceTranscriptEvent(data);
          }
        } catch (error) {
          console.info('[HMP Widget] Realtime event: unreadable_message');
        }
      });

      voiceMediaStream.getAudioTracks().forEach((track) => {
        voicePeerConnection.addTrack(track, voiceMediaStream);
      });

      const offer = await voicePeerConnection.createOffer();
      await voicePeerConnection.setLocalDescription(offer);

      const formData = new FormData();
      formData.append('sdp', offer.sdp);
      formData.append('session', JSON.stringify({
        type: 'realtime',
        model: realtimeSession.model || 'gpt-realtime',
        output_modalities: ['audio'],
        audio: {
          input: {
            noise_reduction: {
              type: 'far_field'
            },
            turn_detection: {
              type: 'server_vad',
              create_response: true,
              interrupt_response: true,
              // A moderate threshold lift rejects room noise without blocking clear barge-in speech.
              threshold: 0.65,
              prefix_padding_ms: 500,
              silence_duration_ms: 1200
            },
            transcription: {
              model: 'gpt-4o-transcribe',
              language: 'en',
            }
          }
        }
      }));

      const response = await fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${realtimeSession.clientSecret}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Realtime WebRTC call returned ${response.status}`);
      }

      const answerSdp = await response.text();
      await voicePeerConnection.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp
      });

      const runtimeContext = await runtimeContextPromise;
      await Promise.all([peerConnectedPromise, dataChannelOpenPromise]);
      updateRealtimeSessionInstructions(runtimeContext.instructions);
      console.info('[HMP Widget] Realtime session instructions updated.');
      console.info('[HMP Widget] Voice assistant ready.');
      setVoiceState('ready');
      if (!hasSentInitialVoiceGreeting) {
        hasSentInitialVoiceGreeting = true;
        voiceDataChannel.send(JSON.stringify({
          type: 'response.create',
          response: {
            instructions: 'For this opening response only, say exactly: "Hi, how can I help you today?" Do not add anything else.'
          }
        }));
      }
    }

    function updateRealtimeSessionInstructions(instructions) {
      if (!voiceDataChannel || voiceDataChannel.readyState !== 'open') {
        throw new Error('Realtime data channel is not open.');
      }

      voiceDataChannel.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions
        }
      }));
    }

    function stopVoiceSession(nextState) {
      if (voiceState !== 'idle' && nextState !== 'error') {
        setVoiceState('ending');
      }
      if (voiceDataChannel) {
        try {
          voiceDataChannel.close();
        } catch (error) {}
        voiceDataChannel = null;
      }
      if (voicePeerConnection) {
        try {
          voicePeerConnection.close();
        } catch (error) {}
        voicePeerConnection = null;
      }
      if (voiceMediaStream) {
        voiceMediaStream.getTracks().forEach((track) => track.stop());
        voiceMediaStream = null;
      }
      if (voiceRemoteStream) {
        voiceRemoteStream.getTracks().forEach((track) => track.stop());
        voiceRemoteStream = null;
      }
      voicePeerConnectedResolve = null;
      voiceDataChannelOpenResolve = null;
      voiceResponseAudioActive = false;
      remoteAudioPlayAttempts = 0;
      persistedVoiceTurnIds.clear();
      processedVoiceLeadTurnIds.clear();
      remoteAudio.pause();
      remoteAudio.srcObject = null;
      setVoiceState(nextState || 'idle');
    }

    function setVoiceState(nextState) {
      voiceState = nextState;
      root.dataset.voiceState = nextState;
      const isVoiceModeActive = nextState !== 'idle';
      messages.hidden = isVoiceModeActive;
      typing.hidden = isVoiceModeActive || typing.hidden;
      form.hidden = isVoiceModeActive;
      voiceStatus.hidden = true;
      voiceStatus.textContent = '';
      voiceMode.hidden = !isVoiceModeActive;
      voiceButton.disabled = isVoiceModeActive;
      voiceButton.classList.toggle('hmp-widget-voice-active', isVoiceSessionActive());
      voiceButton.classList.toggle('hmp-widget-voice-error', nextState === 'error');
      voiceButton.setAttribute(
        'aria-label',
        isVoiceModeActive ? 'Voice mode active' : 'Start voice conversation'
      );
      voiceButton.title = isVoiceModeActive ? 'Voice mode active' : 'Start voice conversation';
      voiceModeStatus.textContent = getVoiceStatusCopy(nextState);
      voiceModeHelper.textContent = getVoiceHelperCopy(nextState);
      voiceEndButton.disabled = nextState === 'ending';
      voiceBackButton.disabled = nextState === 'ending';
    }

    function isVoiceSessionActive() {
      return voiceState !== 'idle' && voiceState !== 'error';
    }

    function handleRealtimeEvent(type) {
      if (!isVoiceSessionActive()) return;
      if (type === 'input_audio_buffer.speech_started') {
        setVoiceState('user_speaking');
      } else if (type === 'input_audio_buffer.speech_stopped' || type === 'response.created') {
        setVoiceState('assistant_thinking');
      } else if (type === 'output_audio_buffer.started') {
        voiceResponseAudioActive = true;
        setVoiceState('assistant_speaking');
        attemptRemoteAudioPlayback(true);
      } else if (type === 'output_audio_buffer.stopped') {
        voiceResponseAudioActive = false;
        setVoiceState('ready');
      } else if (type === 'response.done' && !voiceResponseAudioActive) {
        setVoiceState('ready');
      } else if (type === 'error') {
        setVoiceState('error');
      }
    }

    function handleVoiceTranscriptEvent(data) {
      if (data.type === 'conversation.item.input_audio_transcription.completed') {
        const dedupeKey = `user:${data.item_id || data.event_id || data.type}`;
        persistVoiceTurn('user', data.transcript, dedupeKey);
        sendVoiceLeadProcessingTurn(data.transcript, dedupeKey);
        return;
      } else if (data.type === 'response.output_audio_transcript.done') {
        persistVoiceTurn(
          'assistant',
          data.transcript,
          `assistant:${data.response_id || 'unknown_response'}:${data.item_id || data.output_index || data.content_index || data.event_id || data.type}`
        );
      }
    }

    function persistVoiceTurn(role, rawTranscript, dedupeKey) {
      const message = typeof rawTranscript === 'string' ? rawTranscript.trim() : '';
      if (!message || persistedVoiceTurnIds.has(dedupeKey)) return;

      persistedVoiceTurnIds.add(dedupeKey);
      const pageContext = getPageContext();

      fetch(config.voiceTurnEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          clientId,
          sessionId,
          role,
          message,
          currentUrl: pageContext.currentUrl,
          pageTitle: pageContext.pageTitle,
          eventType: 'voice_message'
        })
      }).then((response) => {
        if (!response.ok) throw new Error(`Voice turn endpoint returned ${response.status}`);
        console.info(`[HMP Widget] ${role === 'user' ? 'User' : 'Assistant'} voice turn persisted.`);
      }).catch((error) => {
        persistedVoiceTurnIds.delete(dedupeKey);
        console.warn('[HMP Widget] Voice turn persistence failed.', {
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      });
    }

    function sendVoiceLeadProcessingTurn(rawTranscript, dedupeKey) {
      const message = typeof rawTranscript === 'string' ? rawTranscript.trim() : '';
      if (!message || processedVoiceLeadTurnIds.has(dedupeKey)) return;

      processedVoiceLeadTurnIds.add(dedupeKey);
      const pageContext = getPageContext();

      fetch(config.voiceLeadProcessingEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          sessionId,
          message,
          currentUrl: pageContext.currentUrl,
          pageTitle: pageContext.pageTitle,
          pageSummary: pageContext.pageSummary,
          eventType: 'voice_message',
          selectedIntent: null,
          intent: 'general'
        })
      }).then((response) => {
        if (!response.ok) throw new Error(`Voice lead processing endpoint returned ${response.status}`);
        console.info('[HMP Widget] User voice lead turn processed.');
      }).catch((error) => {
        processedVoiceLeadTurnIds.delete(dedupeKey);
        console.warn('[HMP Widget] Voice lead processing failed.', {
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      });
    }

    function attemptRemoteAudioPlayback(resetAttempts) {
      if (!remoteAudio.srcObject) return;
      if (resetAttempts) remoteAudioPlayAttempts = 0;
      remoteAudio.play().then(() => {
        remoteAudioPlayAttempts = 0;
      }).catch((error) => {
        remoteAudioPlayAttempts += 1;
        console.warn('[HMP Widget] Remote voice playback was not ready yet.', {
          message: error instanceof Error ? error.message : 'Playback was blocked'
        });
        if (remoteAudioPlayAttempts < 2) {
          window.setTimeout(attemptRemoteAudioPlayback, 250);
        }
      });
    }

    function getVoiceStatusCopy(state) {
      if (state === 'connecting') return 'Starting voice...';
      if (state === 'ready') return 'Listening...';
      if (state === 'user_speaking') return "I'm listening...";
      if (state === 'assistant_thinking') return 'Thinking...';
      if (state === 'assistant_speaking') return 'Speaking...';
      if (state === 'ending') return 'Ending voice...';
      if (state === 'error') return 'Voice connection ran into a problem.';
      return '';
    }

    function getVoiceHelperCopy(state) {
      if (state === 'connecting') return 'Getting your assistant ready.';
      if (state === 'ready') return 'Ask a question whenever you are ready.';
      if (state === 'user_speaking') return 'Keep talking. I will respond when you pause.';
      if (state === 'assistant_thinking') return 'One moment.';
      if (state === 'assistant_speaking') return 'You can interrupt by speaking.';
      if (state === 'ending') return 'Returning to chat.';
      if (state === 'error') return 'End voice and return to chat, then try again.';
      return '';
    }

    function getVoiceErrorMessage(error) {
      if (error && error.name === 'NotAllowedError') return 'Microphone permission was denied.';
      if (error && error.name === 'NotFoundError') return 'No microphone was found.';
      if (error && error.name === 'NotReadableError') return 'The microphone could not be started.';
      return 'Voice could not connect. Please try again.';
    }

    function updateCTAVisibility() {
      const hasConversationStarted = widgetState.hasUserMessage || Boolean(widgetState.selectedIntent);
      const shouldShowCTAButtons = !isPanelOpen && !hasConversationStarted;
      intents.hidden = !shouldShowCTAButtons;
      root.classList.toggle('hmp-widget-has-intents', shouldShowCTAButtons);
    }
  }

  function createIntentButtons() {
    const intents = document.createElement('div');
    intents.className = 'hmp-widget-intents';
    intents.setAttribute('role', 'group');
    intents.setAttribute('aria-label', 'Start with an option');
    intents.hidden = true;
    [
      ['get_quote', 'Get A Quote'],
      ['book_appointment', 'Book Appointment'],
      ['ask_question', 'Ask A Question']
    ].forEach(([intent, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.intent = intent;
      button.textContent = label;
      intents.appendChild(button);
    });
    return intents;
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
  // - suggested replies based on the assistant response
  // - voice mode for speech input and playback
  // - booking flow with date and time selection
  // - human handoff with conversation history
})();
