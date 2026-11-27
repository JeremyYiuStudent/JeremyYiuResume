/* ============================================================
   Live — a private space for two
   Peer-to-peer via PeerJS / WebRTC.  No backend required.
   ============================================================ */
(function () {
  'use strict';

  /* ---- Config ---- */
  var CFG = {
    RECONNECT_MS : 5000,
    HEARTBEAT_MS : 10000,
    HEARTBEAT_TIMEOUT : 8000,
    TAP_COOLDOWN : 800,
    PEER_PREFIX  : 'live',
    STORAGE_KEY  : 'live-room',
    CODE_LEN     : 6,
  };

  /* ---- State ---- */
  var S = {
    roomCode   : null,
    role       : null,     // 'a' (creator) or 'b' (joiner)
    peer       : null,     // PeerJS instance
    conn       : null,     // DataConnection
    call       : null,     // MediaConnection (active call)
    localStream: null,
    connected  : false,
    inCall     : false,
    autoAnswer : true,
    micOn      : true,
    camOn      : true,
    reconnTimer: null,
    tapLock    : false,
    connecting : false,
    hbTimer    : null,
    hbTimeout  : null,
    preMicOn   : true,
    preCamOn   : true,
  };

  /* ---- DOM helpers ---- */
  var $ = function (s) { return document.querySelector(s); };

  var el = {
    setup       : $('#screen-setup'),
    main        : $('#screen-main'),
    callScr     : $('#screen-call'),
    viewCreate  : $('#view-create'),
    viewInvite  : $('#view-invite'),
    viewJoin    : $('#view-join'),
    btnCreate   : $('#btn-create'),
    inviteUrl   : $('#invite-url'),
    btnCopy     : $('#btn-copy'),
    status      : $('#status'),
    statusText  : $('#status-text'),
    btnTap      : $('#btn-tap'),
    btnVideo    : $('#btn-video'),
    btnAudio    : $('#btn-audio'),
    btnSettings : $('#btn-settings'),
    settings    : $('#settings'),
    btnCloseSt  : $('#btn-close-settings'),
    chkAuto     : $('#chk-autoanswer'),
    displayRoom : $('#display-room'),
    btnReset    : $('#btn-reset'),
    settInvRow  : $('#settings-invite-row'),
    btnCopySt   : $('#btn-copy-settings'),
    btnPreMic   : $('#btn-pre-mic'),
    btnPreCam   : $('#btn-pre-cam'),
    vidRemote   : $('#vid-remote'),
    vidLocal    : $('#vid-local'),
    callStatus  : $('#call-status'),
    btnMic      : $('#btn-mic'),
    btnHangup   : $('#btn-hangup'),
    btnCam      : $('#btn-cam'),
    micIcon     : $('#mic-icon'),
    camIcon     : $('#cam-icon'),
    tapOverlay  : $('#tap-overlay'),
    toast       : $('#toast'),
  };

  /* ============================================================
     Utilities
     ============================================================ */
  function randCode(len) {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    var code = '';
    for (var i = 0; i < len; i++) code += chars[arr[i] % chars.length];
    return code;
  }

  function myPeerId()      { return CFG.PEER_PREFIX + '-' + S.roomCode + '-' + S.role; }
  function partnerPeerId() { return CFG.PEER_PREFIX + '-' + S.roomCode + '-' + (S.role === 'a' ? 'b' : 'a'); }
  function inviteLink()    { return location.origin + location.pathname + '#join=' + S.roomCode; }

  function save() {
    try {
      localStorage.setItem(CFG.STORAGE_KEY, JSON.stringify({
        roomCode: S.roomCode, role: S.role, autoAnswer: S.autoAnswer,
        preMicOn: S.preMicOn, preCamOn: S.preCamOn,
      }));
    } catch (e) { /* private browsing */ }
  }

  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(CFG.STORAGE_KEY));
      if (d && d.roomCode && d.role) {
        S.roomCode   = d.roomCode;
        S.role       = d.role;
        S.autoAnswer = d.autoAnswer !== false;
        S.preMicOn   = d.preMicOn !== false;
        S.preCamOn   = d.preCamOn !== false;
        return true;
      }
    } catch (e) { /* missing or corrupt */ }
    return false;
  }

  function clearStorage() {
    try { localStorage.removeItem(CFG.STORAGE_KEY); } catch (e) {}
  }

  /* ============================================================
     Sound  (Web Audio — no external files)
     ============================================================ */
  var AudioCtx = window.AudioContext || window.webkitAudioContext;

  function tone(freq, start, dur, vol, ctx) {
    var osc  = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(vol, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur);
  }

  /* Gentle two-note chime (receive tap) */
  function playChime() {
    if (!AudioCtx) return;
    var ctx = new AudioCtx();
    tone(523.25, ctx.currentTime,       0.55, 0.14, ctx);   // C5
    tone(659.25, ctx.currentTime + 0.12, 0.55, 0.14, ctx);  // E5
  }

  /* Short pop (send tap) */
  function playPop() {
    if (!AudioCtx) return;
    var ctx = new AudioCtx();
    var osc  = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  }

  /* Ascending chord (partner connected) */
  function playConnect() {
    if (!AudioCtx) return;
    var ctx = new AudioCtx();
    var now = ctx.currentTime;
    tone(392.00, now,        0.45, 0.10, ctx);  // G4
    tone(523.25, now + 0.10, 0.45, 0.10, ctx);  // C5
    tone(659.25, now + 0.20, 0.45, 0.10, ctx);  // E5
  }

  /* ============================================================
     Soundboard sounds (synthesized — no external files)
     ============================================================ */
  function playAlarm() {
    if (!AudioCtx) return;
    var ctx = new AudioCtx();
    var now = ctx.currentTime;
    for (var i = 0; i < 6; i++) {
      var t = now + i * 0.22;
      var osc = ctx.createOscillator();
      var g   = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(i % 2 === 0 ? 880 : 700, t);
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.18);
    }
  }

  function playKiss() {
    if (!AudioCtx) return;
    var ctx = new AudioCtx();
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var g   = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);
    osc.frequency.setValueAtTime(1400, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(500, now + 0.18);
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.22);
  }

  function playGiggle() {
    if (!AudioCtx) return;
    var ctx = new AudioCtx();
    var now = ctx.currentTime;
    for (var i = 0; i < 5; i++) {
      var t = now + i * 0.12;
      var osc = ctx.createOscillator();
      var g   = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(500 + (i % 2) * 180, t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.09);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.09);
    }
  }

  function playDoorbell() {
    if (!AudioCtx) return;
    var ctx = new AudioCtx();
    var now = ctx.currentTime;
    tone(659.25, now,        0.5, 0.14, ctx);   // E5
    tone(523.25, now + 0.35, 0.5, 0.14, ctx);   // C5
  }

  var soundMap = {
    alarm:    playAlarm,
    kiss:     playKiss,
    giggle:   playGiggle,
    doorbell: playDoorbell,
  };

  /* ============================================================
     UI
     ============================================================ */
  function showScreen(name) {
    el.setup.classList.remove('active');
    el.main.classList.remove('active');
    el.callScr.classList.remove('active');
    if (name === 'setup') el.setup.classList.add('active');
    if (name === 'main')  el.main.classList.add('active');
    if (name === 'call')  el.callScr.classList.add('active');
  }

  var isReconnecting = false;

  function updateStatus(reconnecting) {
    if (reconnecting !== undefined) isReconnecting = reconnecting;
    var on = S.connected;
    if (on) isReconnecting = false;
    el.status.className = 'status ' + (on ? 'online' : 'offline')
      + (isReconnecting && !on ? ' reconnecting' : '');
    el.statusText.textContent = on ? 'Partner online'
      : isReconnecting ? 'Reconnecting…' : 'Partner offline';
    el.btnVideo.disabled  = !on;
    el.btnAudio.disabled  = !on;
    el.btnTap.disabled    = !on;
    var sbs = document.querySelectorAll('.sb-btn');
    for (var i = 0; i < sbs.length; i++) sbs[i].disabled = !on;
  }

  var toastTimer;
  function showToast(msg, ms) {
    ms = ms || 2500;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, ms);
  }

  /* ============================================================
     PeerJS  —  connection management
     ============================================================ */
  function initPeer() {
    if (S.peer) { try { S.peer.destroy(); } catch (e) {} }

    var peer = new Peer(myPeerId(), {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      }
    });

    peer.on('open', function () {
      console.log('[Live] peer open:', peer.id);
      startReconnect();
    });

    /* Incoming data connection */
    peer.on('connection', function (conn) {
      console.log('[Live] incoming data connection');
      conn.on('open', function () { onConnOpen(conn); });
    });

    /* Incoming media call */
    peer.on('call', function (call) {
      console.log('[Live] incoming call');
      handleIncomingCall(call);
    });

    peer.on('disconnected', function () {
      console.log('[Live] peer disconnected from signaling');
      if (!peer.destroyed) peer.reconnect();
    });

    peer.on('error', function (err) {
      console.error('[Live] peer error:', err.type, err.message);
      if (err.type === 'unavailable-id') {
        showToast('Already open in another tab');
      } else if (err.type === 'peer-unavailable') {
        /* partner not online yet — reconnect loop will retry */
      } else if (err.type === 'network' || err.type === 'server-error') {
        showToast('Connection error — retrying…');
      }
    });

    S.peer = peer;
  }

  function connectToPartner() {
    if (S.connected || S.connecting) return;
    if (!S.peer || S.peer.disconnected || S.peer.destroyed) return;
    S.connecting = true;
    try {
      var conn = S.peer.connect(partnerPeerId(), { reliable: true });
      conn.on('open', function () { S.connecting = false; onConnOpen(conn); });
      conn.on('error', function () { S.connecting = false; });
      setTimeout(function () { S.connecting = false; }, 8000);
    } catch (e) { S.connecting = false; }
  }

  function onConnOpen(conn) {
    if (S.connected && S.conn && S.conn.open && S.conn !== conn) {
      try { conn.close(); } catch (e) {}
      return;
    }
    if (S.conn && S.conn !== conn) {
      try { S.conn.close(); } catch (e) {}
    }
    S.conn      = conn;
    S.connected = true;
    stopReconnect();
    startHeartbeat();
    updateStatus();
    playConnect();
    showToast('Connected ♥');

    conn.on('data',  handleMessage);
    conn.on('close', function () { if (S.conn === conn) onConnClose(); });
    conn.on('error', function () { if (S.conn === conn) onConnClose(); });

    /* If still on setup screen, transition to main */
    if (el.setup.classList.contains('active')) {
      showScreen('main');
    }
  }

  function onConnClose() {
    if (!S.connected) return;          // debounce
    S.connected = false;
    S.conn      = null;
    stopHeartbeat();
    updateStatus();
    if (S.inCall) doEndCall(false);    // end call without sending msg
    startReconnect();
  }

  function startReconnect() {
    if (S.reconnTimer) return;
    updateStatus(true);
    if (S.role === 'a') {
      connectToPartner();
      S.reconnTimer = setInterval(connectToPartner, CFG.RECONNECT_MS);
    } else {
      S.reconnTimer = setInterval(connectToPartner, CFG.RECONNECT_MS * 3);
    }
  }

  function stopReconnect() {
    clearInterval(S.reconnTimer);
    S.reconnTimer = null;
  }

  function startHeartbeat() {
    stopHeartbeat();
    S.hbTimer = setInterval(function () {
      send({ type: 'ping' });
      S.hbTimeout = setTimeout(function () {
        console.log('[Live] heartbeat timeout — connection dead');
        onConnClose();
      }, CFG.HEARTBEAT_TIMEOUT);
    }, CFG.HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    clearInterval(S.hbTimer);  S.hbTimer = null;
    clearTimeout(S.hbTimeout); S.hbTimeout = null;
  }

  function receivedHeartbeat() {
    clearTimeout(S.hbTimeout); S.hbTimeout = null;
  }

  /* ============================================================
     Data-channel messages
     ============================================================ */
  function send(msg) {
    if (S.conn && S.conn.open) S.conn.send(msg);
  }

  function handleMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'tap':      receiveTap(); break;
      case 'sound':    receiveSound(msg.name); break;
      case 'call-end': doEndCall(false); break;
      case 'ping':     send({ type: 'pong' }); break;
      case 'pong':     receivedHeartbeat(); break;
    }
  }

  /* ============================================================
     Room — create / join
     ============================================================ */
  function createRoom() {
    S.roomCode = randCode(CFG.CODE_LEN);
    S.role     = 'a';
    save();
    el.inviteUrl.value = inviteLink();
    el.viewCreate.hidden = true;
    el.viewInvite.hidden = false;
    el.displayRoom.textContent = S.roomCode;
    initPeer();
  }

  function joinRoom(code) {
    S.roomCode = code.toUpperCase();
    S.role     = 'b';
    save();
    el.viewCreate.hidden = true;
    el.viewJoin.hidden   = false;
    el.displayRoom.textContent = S.roomCode;
    history.replaceState(null, '', location.pathname);
    initPeer();
  }

  /* ============================================================
     Tap
     ============================================================ */
  function sendTap() {
    if (!S.connected || S.tapLock) return;
    S.tapLock = true;
    setTimeout(function () { S.tapLock = false; }, CFG.TAP_COOLDOWN);

    send({ type: 'tap' });
    playPop();

    el.btnTap.classList.add('sending');
    setTimeout(function () { el.btnTap.classList.remove('sending'); }, 800);
  }

  function receiveTap() {
    playChime();
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    el.tapOverlay.classList.remove('flash');
    void el.tapOverlay.offsetWidth;          // reflow to restart anim
    el.tapOverlay.classList.add('flash');
    if (S.inCall) showToast('♥');
  }

  function sendSound(name) {
    if (!S.connected) return;
    send({ type: 'sound', name: name });
    if (soundMap[name]) soundMap[name]();
  }

  function receiveSound(name) {
    if (soundMap[name]) soundMap[name]();
    if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
    showToast(
      name === 'alarm'    ? '⏰' :
      name === 'kiss'     ? '💋' :
      name === 'giggle'   ? '😄' :
      name === 'doorbell' ? '🔔' : '🔊'
    );
  }

  /* ============================================================
     Video / audio calls
     ============================================================ */
  function mediaErrorMsg(err) {
    if (err.name === 'NotAllowedError')  return 'Permission denied — check site settings';
    if (err.name === 'NotFoundError')    return 'No camera / mic found';
    if (err.name === 'NotReadableError') return 'Camera busy — close other apps and retry';
    return 'Media error: ' + err.name;
  }

  function getMedia(wantCam, cb, fail) {
    var attempts = wantCam
      ? [
          { video: { facingMode: 'user' }, audio: true },
          { video: true, audio: true },
          { video: false, audio: true },
        ]
      : [{ video: false, audio: true }];

    function tryNext(i) {
      if (i >= attempts.length) { fail(); return; }
      navigator.mediaDevices.getUserMedia(attempts[i])
        .then(function (stream) {
          var hasCam = stream.getVideoTracks().length > 0;
          if (wantCam && !hasCam && i < attempts.length - 1) {
            stream.getTracks().forEach(function (t) { t.stop(); });
            tryNext(i + 1);
            return;
          }
          if (wantCam && !hasCam) showToast('Camera unavailable — audio only');
          cb(stream, hasCam);
        })
        .catch(function (err) {
          console.error('[Live] getUserMedia attempt ' + (i + 1) + ':', err.name);
          if (i < attempts.length - 1) {
            tryNext(i + 1);
          } else {
            showToast(mediaErrorMsg(err));
            fail();
          }
        });
    }
    tryNext(0);
  }

  function startCall(video) {
    if (!S.connected || S.inCall) return;
    S.inCall = true;
    showScreen('call');
    el.callStatus.hidden = false;

    var wantMic = S.preMicOn;
    var wantCam = video && S.preCamOn;

    getMedia(wantCam, function (stream, hasCam) {
      if (!wantMic) stream.getAudioTracks().forEach(function (t) { t.enabled = false; });
      S.localStream      = stream;
      el.vidLocal.srcObject = stream;
      el.vidLocal.hidden    = !hasCam;
      S.micOn = wantMic;
      S.camOn = hasCam;
      updateCallBtns();

      var call = S.peer.call(partnerPeerId(), stream, { metadata: { video: video } });
      setupMediaCall(call);
    }, function () { doEndCall(false); });
  }

  function handleIncomingCall(call) {
    /* Auto-answer (or manual answer in a future version) */
    S.inCall = true;
    showScreen('call');
    el.callStatus.hidden = false;

    var wantVideo = call.metadata && call.metadata.video !== false;
    var wantMic = S.preMicOn;
    var wantCam = wantVideo && S.preCamOn;

    getMedia(wantCam, function (stream, hasCam) {
      if (!wantMic) stream.getAudioTracks().forEach(function (t) { t.enabled = false; });
      S.localStream         = stream;
      el.vidLocal.srcObject = stream;
      el.vidLocal.hidden    = !hasCam;
      S.micOn = wantMic;
      S.camOn = hasCam;
      updateCallBtns();
      call.answer(stream);
      setupMediaCall(call);
    }, function () { doEndCall(false); });
  }

  function setupMediaCall(call) {
    S.call = call;
    call.on('stream', function (remote) {
      el.vidRemote.srcObject = remote;
      el.callStatus.hidden   = true;
    });
    call.on('close', function () { doEndCall(false); });
    call.on('error', function (err) {
      console.error('[Live] call error:', err);
      showToast('Call failed');
      doEndCall(false);
    });
  }

  /** @param {boolean} notify - send call-end to partner */
  function doEndCall(notify) {
    if (S.call) { try { S.call.close(); } catch (e) {} S.call = null; }
    if (S.localStream) {
      S.localStream.getTracks().forEach(function (t) { t.stop(); });
      S.localStream = null;
    }
    el.vidRemote.srcObject = null;
    el.vidLocal.srcObject  = null;
    S.inCall = false;
    showScreen('main');
    if (notify) send({ type: 'call-end' });
  }

  function toggleMic() {
    if (!S.localStream) return;
    S.micOn = !S.micOn;
    S.localStream.getAudioTracks().forEach(function (t) { t.enabled = S.micOn; });
    updateCallBtns();
  }

  function toggleCam() {
    if (!S.localStream) return;
    S.camOn = !S.camOn;
    S.localStream.getVideoTracks().forEach(function (t) { t.enabled = S.camOn; });
    updateCallBtns();
  }

  function updateCallBtns() {
    el.btnMic.classList.toggle('muted', !S.micOn);
    el.btnCam.classList.toggle('muted', !S.camOn);
    el.micIcon.textContent = S.micOn ? '🎤' : '🔇';
    el.camIcon.textContent = S.camOn ? '📷' : '🚫';
  }

  /* ============================================================
     Settings
     ============================================================ */
  function openSettings() {
    el.settings.hidden    = false;
    el.chkAuto.checked    = S.autoAnswer;
    el.displayRoom.textContent = S.roomCode || '—';
    /* Show invite link row only for the room creator */
    el.settInvRow.hidden = !(S.role === 'a' && S.roomCode);
  }

  function closeSettings() {
    el.settings.hidden = true;
    S.autoAnswer = el.chkAuto.checked;
    save();
  }

  function resetRoom() {
    if (!confirm('Unpair and reset? You will need a new invite link.')) return;
    if (S.conn)  { try { S.conn.close(); }    catch (e) {} }
    if (S.peer)  { try { S.peer.destroy(); }   catch (e) {} }
    stopReconnect();
    doEndCall(false);
    clearStorage();
    S.roomCode  = null;
    S.role      = null;
    S.connected = false;
    S.conn      = null;
    S.peer      = null;
    el.settings.hidden    = true;
    el.viewCreate.hidden  = false;
    el.viewInvite.hidden  = true;
    el.viewJoin.hidden    = true;
    updateStatus();
    showScreen('setup');
  }

  /* ============================================================
     Event listeners
     ============================================================ */
  el.btnCreate.addEventListener('click', createRoom);

  el.btnCopy.addEventListener('click', function () {
    navigator.clipboard.writeText(el.inviteUrl.value).then(function () {
      showToast('Link copied!');
    }).catch(function () {
      el.inviteUrl.select();
      showToast('Select + copy the link');
    });
  });

  el.btnCopySt.addEventListener('click', function () {
    navigator.clipboard.writeText(inviteLink()).then(function () {
      showToast('Invite link copied!');
    });
  });

  el.btnTap.addEventListener('click', sendTap);
  el.btnVideo.addEventListener('click', function () { startCall(true);  });
  el.btnAudio.addEventListener('click', function () { startCall(false); });

  document.querySelectorAll('.sb-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { sendSound(btn.dataset.sound); });
  });

  el.btnSettings.addEventListener('click', openSettings);
  el.btnCloseSt.addEventListener('click', closeSettings);
  el.settings.addEventListener('click', function (e) {
    if (e.target === el.settings) closeSettings();
  });
  el.btnReset.addEventListener('click', resetRoom);

  /* Pre-call toggle pills */
  function updatePreCallPills() {
    el.btnPreMic.className = 'pill ' + (S.preMicOn ? 'on' : 'off');
    el.btnPreMic.innerHTML = S.preMicOn ? '&#127908; Mic on' : '&#128263; Mic off';
    el.btnPreCam.className = 'pill ' + (S.preCamOn ? 'on' : 'off');
    el.btnPreCam.innerHTML = S.preCamOn ? '&#128247; Cam on' : '&#128683; Cam off';
  }

  el.btnPreMic.addEventListener('click', function () {
    S.preMicOn = !S.preMicOn;
    updatePreCallPills();
    save();
  });

  el.btnPreCam.addEventListener('click', function () {
    S.preCamOn = !S.preCamOn;
    updatePreCallPills();
    save();
  });

  el.btnMic.addEventListener('click', toggleMic);
  el.btnHangup.addEventListener('click', function () { doEndCall(true); });
  el.btnCam.addEventListener('click', toggleCam);

  /* ============================================================
     Init
     ============================================================ */
  function init() {
    var hash = location.hash;

    updatePreCallPills();

    /* Invite link in URL hash */
    if (hash.indexOf('#join=') === 0) {
      var code = hash.substring(6).toUpperCase();
      if (code.length >= 4) {
        /* Already paired with this room → just reconnect */
        if (load() && S.roomCode === code) {
          history.replaceState(null, '', location.pathname);
          el.displayRoom.textContent = S.roomCode;
          showScreen('main');
          updateStatus(true);
          initPeer();
          return;
        }
        /* Paired with a different room → confirm switch */
        if (load() && S.roomCode !== code) {
          if (!confirm('Already in a room. Switch to this new one?')) {
            history.replaceState(null, '', location.pathname);
            el.displayRoom.textContent = S.roomCode;
            showScreen('main');
            updateStatus(true);
            initPeer();
            return;
          }
        }
        joinRoom(code);
        return;
      }
    }

    /* Existing room in storage → reconnect */
    if (load()) {
      el.displayRoom.textContent = S.roomCode;
      showScreen('main');
      updateStatus(true);           // show "Reconnecting…"
      initPeer();
      return;
    }

    /* Nothing stored → welcome screen */
    showScreen('setup');
  }

  init();
})();
