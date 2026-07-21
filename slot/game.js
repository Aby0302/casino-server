;(function () {
  'use strict'

  // Unity WebView integration
  window.__chipBalance = function (bal) {
    state.balance = bal
    if (els.balance) syncUI()
  }
  window.addEventListener('unitySpin', function (e) {
    state.bet = (e.detail && e.detail.bet) || state.bet
    if (!state.spinning) doSpin()
  })
  function unityReport(type, data) {
    try {
      var url = 'unity://' + type + '?' + JSON.stringify(data)
      window.location = url
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: type, data: data }, '*')
      }
    } catch (e) {}
  }

  var COLS = 6, ROWS = 5

  var state = {
    balance: 10000,
    bet: 100,
    grid: [],
    spinning: false,
    totalWin: 0
  }

  var els = {}
  var audioCtx = null
  var ws = null
  var query = new URLSearchParams(location.search)
  var SESSION_ID = query.get('sessionID') || query.get('session_id') || 'unity-player'
  var INTERNAL_TOKEN = query.get('cloud_internal') || ''
  var SERVER = window.__SERVER_URL || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host)

  function initAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)() } catch (e) {}
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume()
  }

  function tone(freq, dur, vol, type) {
    if (!audioCtx) return
    var osc = audioCtx.createOscillator()
    var gain = audioCtx.createGain()
    osc.type = type || 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(vol || 0.06, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + dur)
  }

  function playSpinSound() {
    initAudio()
    tone(220, 0.07, 0.045, 'square')
    setTimeout(function () { tone(330, 0.07, 0.04, 'square') }, 80)
    setTimeout(function () { tone(440, 0.08, 0.035, 'square') }, 160)
  }

  function playDropSound() { tone(160, 0.05, 0.03, 'triangle') }
  function playStopSound() { tone(260, 0.045, 0.04, 'square') }

  function playWinSound() {
    tone(523, 0.1, 0.06)
    setTimeout(function () { tone(659, 0.11, 0.06) }, 90)
    setTimeout(function () { tone(784, 0.16, 0.07) }, 180)
  }

  function playExplosionSound() {
    if (!audioCtx) return
    for (var i = 0; i < 5; i++) {
      setTimeout(function () { tone(70 + Math.random() * 90, 0.08, 0.035, 'sawtooth') }, i * 18)
    }
  }

  function fmt(n) {
    return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  function render(winningPositions) {
    var winKey = {}
    if (winningPositions) {
      for (var i = 0; i < winningPositions.length; i++) {
        winKey[winningPositions[i][0] + '-' + winningPositions[i][1]] = true
      }
    }
    els.grid.innerHTML = ''
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var cell = document.createElement('div')
        cell.className = 'cell'
        var sym = state.grid[c] && state.grid[c][r]
        if (sym) {
          var div = document.createElement('div')
          div.className = 'sym'
          if (winKey[c + '-' + r]) div.className += ' win'
          div.style.background = sym.color
          div.textContent = sym.text
          div.style.animationDelay = (r * 62 + c * 10) + 'ms'
          cell.appendChild(div)
        }
        els.grid.appendChild(cell)
      }
    }
  }

  function setColumnRolling(col, rolling) {
    var cells = els.grid.children
    for (var r = 0; r < ROWS; r++) {
      var cell = cells[r * COLS + col]
      if (!cell) continue
      if (rolling) {
        cell.classList.add('rolling')
        if (col % 2 === 1) cell.classList.add('up')
        else cell.classList.remove('up')
      } else {
        cell.classList.remove('rolling')
        cell.classList.remove('up')
      }
    }
  }

  function setAllRolling(rolling) {
    for (var c = 0; c < COLS; c++) setColumnRolling(c, rolling)
  }

  function burst(positions) {
    if (!els.fx || !positions || !positions.length) return
    var gridRect = els.grid.getBoundingClientRect()
    var fxRect = els.fx.getBoundingClientRect()
    var cellW = gridRect.width / COLS
    var cellH = gridRect.height / ROWS
    for (var i = 0; i < positions.length; i++) {
      var cx = gridRect.left - fxRect.left + positions[i][0] * cellW + cellW / 2
      var cy = gridRect.top - fxRect.top + positions[i][1] * cellH + cellH / 2
      for (var p = 0; p < 8; p++) {
        var dot = document.createElement('span')
        var angle = Math.random() * Math.PI * 2
        var dist = 26 + Math.random() * 42
        dot.className = 'particle'
        dot.style.left = cx + 'px'
        dot.style.top = cy + 'px'
        dot.style.color = ['#ffd700', '#ff4fb8', '#75ff7b', '#ffffff'][p % 4]
        dot.style.setProperty('--dx', Math.cos(angle) * dist + 'px')
        dot.style.setProperty('--dy', Math.sin(angle) * dist + 'px')
        els.fx.appendChild(dot)
        setTimeout((function (node) { return function () { if (node.parentNode) node.parentNode.removeChild(node) } })(dot), 700)
      }
    }
  }

  function syncUI() {
    els.balance.textContent = 'BALANCE: ' + fmt(state.balance)
    els.bet.textContent = 'BET: ' + fmt(state.bet)
    els.spin.disabled = state.spinning
    els.betDown.disabled = state.spinning
    els.betUp.disabled = state.spinning
  }

  // ── Server-driven spin ──

  function doSpin() {
    if (state.spinning || !ws || ws.readyState !== 1) return
    initAudio()
    if (state.balance < state.bet) {
      els.msg.textContent = 'Yetersiz bakiye'
      return
    }
    state.spinning = true
    els.msg.textContent = ''
    syncUI()
    playSpinSound()
    ws.send(JSON.stringify({ type: 'spin', bet: state.bet }))
  }

  function handleSpinResult(data) {
    state.balance = data.balance
    state.totalWin = 0
    unityReport('bet', { amount: data.bet, balance: data.balance })

    // Build symbol map from server data
    var symDefs = {
      heart: { text: '♥', color: '#e51e57' },
      diamond: { text: '♦', color: '#b235e6' },
      banana: { text: '🍌', color: '#d9bf29' },
      apple: { text: '🍎', color: '#e62f35' },
      orange: { text: '🍊', color: '#e98305' },
      watermelon: { text: '🍉', color: '#39ad48' },
      plum: { text: '🟣', color: '#7d21c9' },
      grape: { text: '🍇', color: '#5b2e96' },
      scatter: { text: '★', color: '#d8a719' }
    }

    var spinEvent = data.events[0]
    if (spinEvent && spinEvent.type === 'spin') {
      state.grid = spinEvent.grid.map(function (col) {
        return col.map(function (s) {
          if (!s) return null
          var def = symDefs[s.id] || {}
          return { id: s.id, text: def.text, color: def.color }
        })
      })
    }

    render()
    setAllRolling(true)

    var ticks = 0
    var interval = setInterval(function () {
      ticks++
      render()
      setAllRolling(true)
      if (ticks > 9) {
        clearInterval(interval)
        stopColumns(0, data)
      }
    }, 210)
  }

  function stopColumns(col, data) {
    if (col >= COLS) {
      setAllRolling(false)
      setTimeout(function () { playTumbles(1, data) }, 420)
      return
    }
    render()
    for (var c = col + 1; c < COLS; c++) setColumnRolling(c, true)
    setColumnRolling(col, false)
    playStopSound()
    setTimeout(function () { stopColumns(col + 1, data) }, 360 + col * 55)
  }

  function playTumbles(idx, data) {
    if (idx >= data.events.length) {
      finishSpin(data)
      return
    }

    var ev = data.events[idx]
    if (ev.type === 'tumble') {
      // Show winning positions, update grid
      var allPos = []
      for (var w = 0; w < ev.wins.length; w++) {
        allPos = allPos.concat(ev.wins[w].positions)
      }
      state.totalWin = data.totalWin
      els.msg.textContent = 'WIN: ' + fmt(data.totalWin)
      render(allPos)
      burst(allPos)
      playWinSound()
      playExplosionSound()

      setTimeout(function () {
        // After explosion, show dropped grid
        for (var i = idx + 1; i < data.events.length; i++) {
          if (data.events[i].type === 'drop') {
            state.grid = data.events[i].grid.map(function (col) {
              return col.map(function (s) {
                if (!s) return null
                var def = s.id ? { heart: { text: '♥', color: '#e51e57' }, diamond: { text: '♦', color: '#b235e6' }, banana: { text: '🍌', color: '#d9bf29' }, apple: { text: '🍎', color: '#e62f35' }, orange: { text: '🍊', color: '#e98305' }, watermelon: { text: '🍉', color: '#39ad48' }, plum: { text: '🟣', color: '#7d21c9' }, grape: { text: '🍇', color: '#5b2e96' }, scatter: { text: '★', color: '#d8a719' } }[s.id] : {}
                return { id: s.id, text: def.text, color: def.color }
              })
            })
            break
          }
        }
        playDropSound()
        render()
        setTimeout(function () { playTumbles(idx + 1, data) }, 480)
      }, 500)
    } else {
      // Skip non-tumble events (spin, drop)
      playTumbles(idx + 1, data)
    }
  }

  function finishSpin(data) {
    state.balance = data.balance
    state.spinning = false
    if (data.totalWin > 0) {
      els.msg.textContent = 'PAID: ' + fmt(data.totalWin)
      unityReport('win', { amount: data.totalWin, balance: data.balance })
    } else {
      els.msg.textContent = ''
    }
    syncUI()
  }

  // ── WebSocket ──

  function connectWS() {
    var separator = SERVER.indexOf('?') >= 0 ? '&' : '?'
    var internal = INTERNAL_TOKEN ? '&cloud_internal=' + encodeURIComponent(INTERNAL_TOKEN) : ''
    ws = new WebSocket(SERVER + separator + 'game=slot&sessionID=' + encodeURIComponent(SESSION_ID) + internal)
    ws.onopen = function () {
      console.log('Connected to casino server')
    }
    ws.onmessage = function (raw) {
      try {
        var msg = JSON.parse(raw.data)
        switch (msg.type) {
          case 'connected':
            if (msg.balance != null) state.balance = msg.balance
            syncUI()
            break
          case 'spinResult':
            handleSpinResult(msg)
            break
          case 'balance':
            state.balance = msg.balance
            syncUI()
            break
          case 'error':
            console.error('Server:', msg.message)
            state.spinning = false
            syncUI()
            break
        }
      } catch (e) {}
    }
    ws.onclose = function () {
      console.log('Disconnected, retrying in 3s...')
      setTimeout(connectWS, 3000)
    }
    ws.onerror = function () {}
  }

  // ── Init ──

  function init() {
    els.grid = document.getElementById('grid')
    els.balance = document.getElementById('balance')
    els.bet = document.getElementById('bet')
    els.fx = document.getElementById('fx')
    els.spin = document.getElementById('spin')
    els.betDown = document.getElementById('bet-down')
    els.betUp = document.getElementById('bet-up')
    els.msg = document.getElementById('msg')

    // Placeholder grid
    state.grid = Array.from({ length: COLS }, function () { return Array(ROWS).fill(null) })
    render()
    syncUI()

    els.spin.addEventListener('click', doSpin)
    els.spin.addEventListener('touchend', function (e) { e.preventDefault(); doSpin() }, { passive: false })
    els.betDown.addEventListener('click', function () {
      if (state.spinning) return
      state.bet = Math.max(10, Math.floor(state.bet / 2))
      syncUI()
    })
    els.betUp.addEventListener('click', function () {
      if (state.spinning) return
      state.bet = Math.min(5000, state.bet * 2)
      syncUI()
    })

    connectWS()
    window.__game = state
  }

  document.addEventListener('DOMContentLoaded', init)
})()
