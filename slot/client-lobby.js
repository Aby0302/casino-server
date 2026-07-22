;(function () {
  'use strict'

  const state = {
    sessionID: '',
    balance: null,
    socket: null,
    socketTimer: null,
    maintenanceTimer: null,
    currentGame: '',
    config: null,
  }

  const els = {
    playerPill: document.getElementById('player-pill'),
    balancePill: document.getElementById('balance-pill'),
    socketPill: document.getElementById('socket-pill'),
    playerID: document.getElementById('player-id'),
    playerName: document.getElementById('player-name'),
    profileForm: document.getElementById('profile-form'),
    refreshConfig: document.getElementById('refresh-config'),
    message: document.getElementById('message'),
    machines: document.getElementById('machines'),
    machineCount: document.getElementById('machine-count'),
    gameLayer: document.getElementById('game-layer'),
    gameFrame: document.getElementById('game-frame'),
    gameTitle: document.getElementById('game-title'),
    closeGame: document.getElementById('close-game'),
    maintenancePanel: document.getElementById('maintenance-panel'),
    maintenanceReason: document.getElementById('maintenance-reason'),
  }

  function setMessage(text) {
    els.message.textContent = text || ''
  }

  function formatBalance(value) {
    const number = Number(value)
    if (!Number.isFinite(number)) return '...'
    return number.toLocaleString('en-US')
  }

  function syncSessionUI() {
    els.playerPill.textContent = state.sessionID || 'unknown'
    els.playerID.value = state.sessionID || ''
    els.balancePill.textContent = formatBalance(state.balance)
  }

  function lobbyUrlForSession(sessionID) {
    return '/client/lobby?sessionID=' + encodeURIComponent(sessionID)
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, Object.assign({ cache: 'no-store' }, options || {}))
    if (!response.ok) throw new Error(url + ' failed with HTTP ' + response.status)
    return response.json()
  }

  async function fetchMaintenance(game) {
    const query = game ? '?game=' + encodeURIComponent(game) : ''
    const data = await fetchJson('/api/maintenance' + query)
    return data.maintenance || { active: false }
  }

  function isCurrentMaintenance(maintenance, messageGame) {
    const game = messageGame || (maintenance && maintenance.game)
    return isGameOpen() && state.currentGame && game === state.currentGame
  }

  function showMaintenance(maintenance) {
    els.gameFrame.src = 'about:blank'
    els.gameFrame.classList.add('maintenance')
    els.maintenancePanel.classList.add('show')
    els.maintenanceReason.textContent = 'Reason: ' + ((maintenance && maintenance.reason) || 'automatic check')
    els.gameLayer.classList.add('active')
  }

  function isGameOpen() {
    return els.gameLayer.classList.contains('active')
  }

  function hideMaintenance() {
    els.gameFrame.classList.remove('maintenance')
    els.maintenancePanel.classList.remove('show')
  }

  function startMaintenanceWatch() {
    if (state.maintenanceTimer) clearInterval(state.maintenanceTimer)
    state.maintenanceTimer = setInterval(async () => {
      if (!isGameOpen()) return
      try {
        const maintenance = await fetchMaintenance(state.currentGame)
        if (maintenance.active && isCurrentMaintenance(maintenance)) showMaintenance(maintenance)
      } catch (_) {}
    }, 5000)
  }

  function stopMaintenanceWatch() {
    if (state.maintenanceTimer) clearInterval(state.maintenanceTimer)
    state.maintenanceTimer = null
  }

  async function loadSession() {
    const session = await fetchJson('/client/session')
    state.sessionID = session.sessionID || 'godot-player'
    state.balance = session.balance
    syncSessionUI()
  }

  async function loadConfig() {
    setMessage('Loading casino config...')
    state.config = await fetchJson('/casino-config.json?v=' + Date.now())
    renderMachines()
    setMessage('')
  }

  function machineTitle(machine) {
    const game = String(machine.game || 'sugar-rush')
    if (game === 'sugar-rush') return 'Sugar Rush'
    return game.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  function renderMachines() {
    const machines = Array.isArray(state.config && state.config.machines) ? state.config.machines : []
    els.machineCount.textContent = String(machines.length)
    els.machines.textContent = ''

    if (!machines.length) {
      const empty = document.createElement('p')
      empty.className = 'copy'
      empty.textContent = 'No machines are configured yet.'
      els.machines.appendChild(empty)
      return
    }

    for (const machine of machines) {
      const game = String(machine.game || 'sugar-rush')
      const supported = game === 'sugar-rush'
      const card = document.createElement('article')
      card.className = 'machine-card'

      const art = document.createElement('div')
      art.className = 'machine-art'
      const cabinet = document.createElement('div')
      cabinet.className = 'cabinet'
      art.appendChild(cabinet)

      const body = document.createElement('div')
      body.className = 'machine-body'
      const title = document.createElement('h3')
      title.className = 'machine-title'
      title.textContent = machineTitle(machine)
      const meta = document.createElement('p')
      meta.className = 'machine-meta'
      meta.textContent = (machine.id || 'slot') + ' / ' + game
      const actions = document.createElement('div')
      actions.className = 'machine-actions'
      const play = document.createElement('button')
      play.type = 'button'
      play.textContent = supported ? 'Play now' : 'Unsupported'
      play.disabled = !supported
      play.addEventListener('click', () => openGame(machine))
      actions.appendChild(play)

      body.appendChild(title)
      body.appendChild(meta)
      body.appendChild(actions)
      card.appendChild(art)
      card.appendChild(body)
      els.machines.appendChild(card)
    }
  }

  async function openGame(machine) {
    const game = String(machine.game || 'sugar-rush')
    if (game !== 'sugar-rush') {
      setMessage('This game is not enabled for the web lobby yet.')
      return
    }

    state.currentGame = game
    const maintenance = await fetchMaintenance(game).catch(() => ({ active: false }))
    if (maintenance.active) {
      els.gameTitle.textContent = machineTitle(machine)
      showMaintenance(maintenance)
      startMaintenanceWatch()
      return
    }

    els.gameTitle.textContent = machineTitle(machine)
    els.gameLayer.classList.add('active')
    hideMaintenance()
    els.gameFrame.src = '/client/start?game=' + encodeURIComponent(game) + '&sessionID=' + encodeURIComponent(state.sessionID)
    startMaintenanceWatch()
  }

  function closeGame() {
    els.gameFrame.src = 'about:blank'
    state.currentGame = ''
    hideMaintenance()
    stopMaintenanceWatch()
    els.gameLayer.classList.remove('active')
  }

  function socketUrl() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return protocol + '//' + location.host + '/?game=balance&sessionID=' + encodeURIComponent(state.sessionID)
  }

  function connectSocket() {
    if (!state.sessionID) return
    if (state.socket) state.socket.close()
    if (state.socketTimer) clearTimeout(state.socketTimer)

    els.socketPill.textContent = 'connecting'
    const ws = new WebSocket(socketUrl())
    state.socket = ws

    ws.addEventListener('open', () => {
      els.socketPill.textContent = 'online'
    })

    ws.addEventListener('message', event => {
      let payload
      try { payload = JSON.parse(event.data) } catch (_) { return }
      if (payload && Object.prototype.hasOwnProperty.call(payload, 'balance')) {
        state.balance = payload.balance
        syncSessionUI()
      }
      if (payload && payload.type === 'config:updated') {
        loadConfig().catch(error => setMessage(error.message))
      }
      if (payload && payload.type === 'maintenance:updated' && payload.maintenance && payload.maintenance.active && isCurrentMaintenance(payload.maintenance, payload.game)) {
        showMaintenance(payload.maintenance)
      }
    })

    ws.addEventListener('close', () => {
      if (state.socket !== ws) return
      els.socketPill.textContent = 'offline'
      state.socketTimer = setTimeout(connectSocket, 1800)
    })

    ws.addEventListener('error', () => {
      els.socketPill.textContent = 'error'
    })
  }

  function notifyNativePlayer(id, name) {
    const payload = { type: 'setPlayer', id, name }
    if (typeof window.sendIpcMessage === 'function') {
      try { window.sendIpcMessage(JSON.stringify(payload)) } catch (_) {}
    }
    if (window.CasinoShell && typeof window.CasinoShell.setPlayer === 'function') {
      try { window.CasinoShell.setPlayer(id, name) } catch (_) {}
    }
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.casinoShell) {
      try { window.webkit.messageHandlers.casinoShell.postMessage(payload) } catch (_) {}
    }
  }

  async function savePlayer(event) {
    event.preventDefault()
    const id = els.playerID.value.trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 128)
    const name = els.playerName.value.trim() || id
    if (!id) {
      setMessage('Player ID is required.')
      return
    }

    setMessage('Saving player...')
    await fetchJson('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    })
    notifyNativePlayer(id, name)
    location.href = lobbyUrlForSession(id)
  }

  async function boot() {
    try {
      await loadSession()
      connectSocket()
      await loadConfig()
    } catch (error) {
      setMessage(error.message || String(error))
    }
  }

  els.profileForm.addEventListener('submit', event => {
    savePlayer(event).catch(error => setMessage(error.message || String(error)))
  })
  els.refreshConfig.addEventListener('click', () => {
    loadConfig().catch(error => setMessage(error.message || String(error)))
  })
  els.closeGame.addEventListener('click', closeGame)
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && els.gameLayer.classList.contains('active')) closeGame()
  })

  boot()
})()
