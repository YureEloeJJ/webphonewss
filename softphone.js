


    /**
     * Softphone WSS - Sistema VoIP WebSocket
     * @version 7.0
     * @description Softphone com Transcript em tempo real
     */
    (function() {
      'use strict';

      // ============================================
      // CONSTANTS
      // ============================================
      const VERSION = '7.0';
      const APP_NAME = 'Softphone WSS';
      
      const STORAGE_KEYS = Object.freeze({
        CONFIG: 'softphone_wss_config',
        THEME: 'softphone_wss_theme',
        LOGS: 'softphone_wss_logs',
        HISTORY: 'softphone_wss_history',
        CONTACTS: 'softphone_wss_contacts',
        TRANSCRIPTS: 'softphone_wss_transcripts',
        CREDITS_CLOSED: 'softphone_wss_credits_closed'
      });

      const MAX_LOGS = 300;
      const MAX_HISTORY = 100;
      const MAX_CONTACTS = 500;
      const TOAST_DURATION = 3500;
      const STATUS_RESET_DELAY = 2500;
      const SAVE_DEBOUNCE_MS = 500;
      const STATS_UPDATE_INTERVAL = 1000;

      const LOG_TYPES = Object.freeze({
        INFO: 'info',
        SUCCESS: 'success',
        WARNING: 'warning',
        ERROR: 'error',
        DEBUG: 'debug'
      });

      const ERROR_CODES = Object.freeze({
        JSSIP_NOT_LOADED: 'E001',
        VALIDATION: 'E002',
        CONNECTION: 'E003',
        REGISTRATION: 'E004',
        CALL: 'E005',
        MEDIA: 'E006',
        STORAGE: 'E007',
        NETWORK: 'E008',
        WEBSOCKET: 'E009',
        SIP: 'E010',
        CONTACT: 'E011'
      });

      const SIP_ERRORS = Object.freeze({
        400: 'Requisicao mal formada',
        401: 'Nao autorizado - verifique credenciais',
        403: 'Proibido - acesso negado',
        404: 'Usuario nao encontrado',
        408: 'Timeout - servidor nao respondeu',
        480: 'Temporariamente indisponivel',
        486: 'Ocupado',
        487: 'Chamada cancelada',
        488: 'Codec nao aceito',
        500: 'Erro interno do servidor',
        502: 'Bad Gateway',
        503: 'Servico indisponivel',
        504: 'Timeout do gateway',
        600: 'Ocupado em toda parte',
        603: 'Recusado'
      });

      let jsSIPLoaded = false;
      let jsSIPVersion = 'nao carregado';
      
      function checkJsSIP() {
        if (typeof JsSIP !== 'undefined') {
          jsSIPLoaded = true;
          jsSIPVersion = JsSIP.version || '3.x';
          return true;
        }
        return false;
      }

      checkJsSIP();

      // ============================================
      // ERROR HANDLER
      // ============================================
      const ErrorHandler = {
        wrap(fn, context = 'Operacao') {
          return function(...args) {
            try {
              return fn.apply(this, args);
            } catch (error) {
              ErrorHandler.handle(error, context);
            }
          };
        },

        async wrapAsync(fn, context = 'Operacao') {
          try {
            return await fn();
          } catch (error) {
            ErrorHandler.handle(error, context);
          }
        },

        handle(error, context = 'Erro') {
          const errorMsg = error?.message || String(error);
          const errorCode = error?.code || 'UNKNOWN';
          
          console.error(`[${APP_NAME}] ${context}:`, error);
          
          if (typeof Softphone !== 'undefined' && Softphone.log) {
            Softphone.log(`[${errorCode}] ${context}: ${errorMsg}`, LOG_TYPES.ERROR);
          }
        },

        getSIPErrorMessage(code) {
          return SIP_ERRORS[code] || `Erro SIP ${code}`;
        }
      };

      // ============================================
      // UTILITY FUNCTIONS
      // ============================================
      const Utils = {
        $(id) {
          return document.getElementById(id);
        },

        $$(selector) {
          return document.querySelectorAll(selector);
        },

        debounce(fn, ms) {
          let timer;
          return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), ms);
          };
        },

        formatTime(date) {
          return date.toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
          });
        },

        formatDate(date) {
          return date.toLocaleDateString('pt-BR', { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
        },

        formatDuration(seconds) {
          if (!seconds || seconds < 0) return '00:00';
          const mins = Math.floor(seconds / 60);
          const secs = Math.floor(seconds % 60);
          return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        },

        generateId() {
          return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        },

        sanitizeNumber(number) {
          return String(number || '').replace(/[^\d*#]/g, '');
        },

        getInitials(name) {
          if (!name) return '?';
          const parts = name.trim().split(' ');
          if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
          }
          return name.substring(0, 2).toUpperCase();
        },

        isValidWSS(url) {
          if (!url) return false;
          try {
            const parsed = new URL(url);
            return parsed.protocol === 'wss:' || parsed.protocol === 'ws:';
          } catch {
            return false;
          }
        },

        isValidDomain(domain) {
          if (!domain) return false;
          const pattern = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$|^(\d{1,3}\.){3}\d{1,3}$/;
          return pattern.test(domain);
        },

        escapeHtml(str) {
          const div = document.createElement('div');
          div.textContent = str;
          return div.innerHTML;
        }
      };

      // ============================================
      // STORAGE MANAGER
      // ============================================
      const Storage = {
        get(key, defaultValue = null) {
          try {
            const item = localStorage.getItem(key);
            if (item === null) return defaultValue;
            return JSON.parse(item);
          } catch (error) {
            ErrorHandler.handle(error, `Storage.get(${key})`);
            return defaultValue;
          }
        },

        set(key, value) {
          try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
          } catch (error) {
            if (error.name === 'QuotaExceededError') {
              this.cleanup();
              try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
              } catch {
                ErrorHandler.handle(error, 'Storage.set - quota exceeded');
              }
            }
            ErrorHandler.handle(error, `Storage.set(${key})`);
            return false;
          }
        },

        remove(key) {
          try {
            localStorage.removeItem(key);
            return true;
          } catch (error) {
            ErrorHandler.handle(error, `Storage.remove(${key})`);
            return false;
          }
        },

        cleanup() {
          try {
            const logs = this.get(STORAGE_KEYS.LOGS, []);
            if (logs.length > 50) {
              this.set(STORAGE_KEYS.LOGS, logs.slice(-50));
            }
            
            const history = this.get(STORAGE_KEYS.HISTORY, []);
            if (history.length > 20) {
              this.set(STORAGE_KEYS.HISTORY, history.slice(-20));
            }
          } catch (error) {
            ErrorHandler.handle(error, 'Storage.cleanup');
          }
        }
      };

      // ============================================
      // CONTACTS MANAGER
      // ============================================
      const ContactsManager = {
        contacts: [],

        init() {
          this.contacts = Storage.get(STORAGE_KEYS.CONTACTS, []);
          this.render();
          this.renderFavorites();
          this.updateCounts();
        },

        add(name, number) {
          if (!name || !number) {
            Softphone.log(`[${ERROR_CODES.CONTACT}] Nome e numero sao obrigatorios`, LOG_TYPES.ERROR);
            Softphone.toast('Preencha nome e numero', 'error');
            return false;
          }

          const sanitizedNumber = Utils.sanitizeNumber(number);
          if (!sanitizedNumber) {
            Softphone.log(`[${ERROR_CODES.CONTACT}] Numero invalido`, LOG_TYPES.ERROR);
            Softphone.toast('Numero invalido', 'error');
            return false;
          }

          // Check duplicate
          const exists = this.contacts.find(c => c.number === sanitizedNumber);
          if (exists) {
            Softphone.log(`[${ERROR_CODES.CONTACT}] Numero ja cadastrado`, LOG_TYPES.WARNING);
            Softphone.toast('Numero ja existe', 'warning');
            return false;
          }

          const contact = {
            id: Utils.generateId(),
            name: name.trim(),
            number: sanitizedNumber,
            favorite: false,
            createdAt: new Date().toISOString()
          };

          this.contacts.unshift(contact);

          if (this.contacts.length > MAX_CONTACTS) {
            this.contacts = this.contacts.slice(0, MAX_CONTACTS);
          }

          this.save();
          this.render();
          this.renderFavorites();
          this.updateCounts();

          Softphone.log(`Contato adicionado: ${contact.name} (${contact.number})`, LOG_TYPES.SUCCESS);
          Softphone.toast('Contato adicionado', 'success');
          return true;
        },

        remove(id) {
          const contact = this.contacts.find(c => c.id === id);
          if (contact) {
            Softphone.log(`Contato removido: ${contact.name}`, LOG_TYPES.INFO);
          }
          
          this.contacts = this.contacts.filter(c => c.id !== id);
          this.save();
          this.render();
          this.renderFavorites();
          this.updateCounts();
        },

        toggleFavorite(id) {
          const contact = this.contacts.find(c => c.id === id);
          if (contact) {
            contact.favorite = !contact.favorite;
            this.save();
            this.render();
            this.renderFavorites();
            this.updateCounts();

            if (contact.favorite) {
              Softphone.log(`${contact.name} adicionado aos favoritos`, LOG_TYPES.INFO);
              Softphone.toast('Adicionado aos favoritos', 'success');
            } else {
              Softphone.log(`${contact.name} removido dos favoritos`, LOG_TYPES.INFO);
            }
          }
        },

        search(query) {
          if (!query) {
            this.render();
            return;
          }

          const q = query.toLowerCase();
          const filtered = this.contacts.filter(c => 
            c.name.toLowerCase().includes(q) || 
            c.number.includes(q)
          );

          this.renderList(filtered);
        },

        save() {
          Storage.set(STORAGE_KEYS.CONTACTS, this.contacts);
        },

        updateCounts() {
          const contactsCount = Utils.$('contactsCount');
          const favoritesCount = Utils.$('favoritesCount');
          
          if (contactsCount) {
            contactsCount.textContent = this.contacts.length;
          }
          
          if (favoritesCount) {
            favoritesCount.textContent = this.contacts.filter(c => c.favorite).length;
          }
        },

        render() {
          this.renderList(this.contacts);
        },

        renderList(contacts) {
          const container = Utils.$('contactsList');
          const emptyState = Utils.$('contactsEmpty');
          
          if (!container) return;

          if (contacts.length === 0) {
            container.innerHTML = '';
            if (emptyState) emptyState.style.display = 'flex';
            return;
          }

          if (emptyState) emptyState.style.display = 'none';

          const fragment = document.createDocumentFragment();

          contacts.forEach(contact => {
            const div = document.createElement('div');
            div.className = 'contact-item';
            div.innerHTML = `
              <div class="contact-avatar">${Utils.getInitials(contact.name)}</div>
              <div class="contact-info">
                <div class="contact-name">${Utils.escapeHtml(contact.name)}</div>
                <div class="contact-number">${contact.number}</div>
              </div>
              <div class="contact-actions">
                <button class="contact-action-btn call" data-number="${contact.number}" title="Ligar">
                  <svg viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                </button>
                <button class="contact-action-btn favorite ${contact.favorite ? 'active' : ''}" data-id="${contact.id}" title="Favorito">
                  <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                </button>
                <button class="contact-action-btn delete" data-id="${contact.id}" title="Remover">
                  <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            `;
            fragment.appendChild(div);
          });

          container.innerHTML = '';
          container.appendChild(fragment);

          // Bind events
          container.querySelectorAll('.contact-action-btn.call').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const number = btn.dataset.number;
              Softphone.dialNumber(number);
            });
          });

          container.querySelectorAll('.contact-action-btn.favorite').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.toggleFavorite(btn.dataset.id);
            });
          });

          container.querySelectorAll('.contact-action-btn.delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (confirm('Remover este contato?')) {
                this.remove(btn.dataset.id);
              }
            });
          });

          // Click to call
          container.querySelectorAll('.contact-item').forEach((item, index) => {
            item.addEventListener('click', () => {
              const number = contacts[index].number;
              Softphone.dialNumber(number);
            });
          });
        },

        renderFavorites() {
          const container = Utils.$('favoritesList');
          const emptyState = Utils.$('favoritesEmpty');
          
          if (!container) return;

          const favorites = this.contacts.filter(c => c.favorite);

          if (favorites.length === 0) {
            container.innerHTML = '';
            if (emptyState) emptyState.style.display = 'flex';
            return;
          }

          if (emptyState) emptyState.style.display = 'none';

          const fragment = document.createDocumentFragment();

          favorites.forEach(contact => {
            const div = document.createElement('div');
            div.className = 'favorite-item';
            div.dataset.number = contact.number;
            div.innerHTML = `
              <svg class="favorite-item-star" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
              <div class="favorite-item-avatar">${Utils.getInitials(contact.name)}</div>
              <div class="favorite-item-name">${Utils.escapeHtml(contact.name)}</div>
              <div class="favorite-item-number">${contact.number}</div>
            `;
            fragment.appendChild(div);
          });

          container.innerHTML = '';
          container.appendChild(fragment);

          // Click to call
          container.querySelectorAll('.favorite-item').forEach(item => {
            item.addEventListener('click', () => {
              const number = item.dataset.number;
              Softphone.dialNumber(number);
            });
          });
        }
      };

      // ============================================
      // NETWORK STATS MANAGER
      // ============================================
      const NetworkStats = {
        statsInterval: null,
        peerConnection: null,

        start(pc) {
          this.peerConnection = pc;
          this.statsInterval = setInterval(() => this.update(), STATS_UPDATE_INTERVAL);
          Utils.$('networkStats').classList.add('active');
          Softphone.log('Monitoramento de rede iniciado', LOG_TYPES.DEBUG);
        },

        stop() {
          if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
          }
          this.peerConnection = null;
          Utils.$('networkStats').classList.remove('active');
          
          // Reset values
          Utils.$('statLatency').textContent = '--';
          Utils.$('statLatency').className = 'network-stat-value';
          Utils.$('statJitter').textContent = '--';
          Utils.$('statJitter').className = 'network-stat-value';
          Utils.$('statPacketLoss').textContent = '--';
          Utils.$('statPacketLoss').className = 'network-stat-value';
        },

        async update() {
          if (!this.peerConnection) return;

          try {
            const stats = await this.peerConnection.getStats();
            let latency = null;
            let jitter = null;
            let packetsLost = 0;
            let packetsReceived = 0;

            stats.forEach(report => {
              if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                latency = report.currentRoundTripTime;
              }
              
              if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                jitter = report.jitter;
                packetsLost = report.packetsLost || 0;
                packetsReceived = report.packetsReceived || 0;
              }
            });

            // Update UI
            const latencyEl = Utils.$('statLatency');
            const jitterEl = Utils.$('statJitter');
            const packetLossEl = Utils.$('statPacketLoss');

            if (latency !== null) {
              const latencyMs = Math.round(latency * 1000);
              latencyEl.textContent = latencyMs + 'ms';
              latencyEl.className = 'network-stat-value ' + this.getQualityClass(latencyMs, 100, 200);
            }

            if (jitter !== null) {
              const jitterMs = Math.round(jitter * 1000);
              jitterEl.textContent = jitterMs + 'ms';
              jitterEl.className = 'network-stat-value ' + this.getQualityClass(jitterMs, 30, 50);
            }

            if (packetsReceived > 0) {
              const lossPercent = ((packetsLost / (packetsReceived + packetsLost)) * 100).toFixed(1);
              packetLossEl.textContent = lossPercent + '%';
              packetLossEl.className = 'network-stat-value ' + this.getQualityClass(parseFloat(lossPercent), 1, 3);
            }

          } catch (error) {
            // Silently ignore stats errors
          }
        },

        getQualityClass(value, goodThreshold, badThreshold) {
          if (value <= goodThreshold) return 'good';
          if (value <= badThreshold) return 'medium';
          return 'bad';
        }
      };

      // ============================================
      // CALL HISTORY MANAGER
      // ============================================
      const CallHistory = {
        calls: [],

        init() {
          this.calls = Storage.get(STORAGE_KEYS.HISTORY, []);
          this.render();
          this.updateCount();
        },

        add(callData) {
          const call = {
            id: Utils.generateId(),
            number: callData.number || 'Desconhecido',
            type: callData.type || 'outgoing',
            status: callData.status || 'completed',
            duration: callData.duration || 0,
            startTime: callData.startTime || new Date().toISOString(),
            endTime: callData.endTime || new Date().toISOString()
          };

          this.calls.unshift(call);
          
          if (this.calls.length > MAX_HISTORY) {
            this.calls = this.calls.slice(0, MAX_HISTORY);
          }

          this.save();
          this.render();
          this.updateCount();

          Softphone.log(`Chamada registrada: ${call.number} (${call.type})`, LOG_TYPES.INFO);
        },

        remove(id) {
          this.calls = this.calls.filter(c => c.id !== id);
          this.save();
          this.render();
          this.updateCount();
        },

        clear() {
          this.calls = [];
          this.save();
          this.render();
          this.updateCount();
          Softphone.log('Historico de chamadas limpo', LOG_TYPES.INFO);
        },

        save() {
          Storage.set(STORAGE_KEYS.HISTORY, this.calls);
        },

        updateCount() {
          const countEl = Utils.$('historyCount');
          if (countEl) {
            countEl.textContent = this.calls.length;
          }
        },

        render() {
          const container = Utils.$('historyList');
          const emptyState = Utils.$('historyEmpty');
          
          if (!container) return;

          if (this.calls.length === 0) {
            container.innerHTML = '';
            if (emptyState) emptyState.style.display = 'flex';
            return;
          }

          if (emptyState) emptyState.style.display = 'none';

          const fragment = document.createDocumentFragment();

          this.calls.forEach(call => {
            const div = document.createElement('div');
            div.className = 'transcript-call';
            div.innerHTML = `
              <div class="transcript-call-header">
                <div class="transcript-call-info">
                  <span class="transcript-call-number">${Utils.escapeHtml(call.number)}</span>
                  <span class="transcript-call-date">${Utils.formatDate(new Date(call.startTime))}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <span class="transcript-call-badge ${call.type}">${this.getTypeLabel(call.type)}</span>
                  <button class="transcript-call-delete" data-id="${call.id}" title="Remover">
                    <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                  </button>
                </div>
              </div>
              <div class="transcript-call-stats">
                <div class="transcript-stat">
                  <span class="transcript-stat-label">Duracao</span>
                  <span class="transcript-stat-value">${Utils.formatDuration(call.duration)}</span>
                </div>
                <div class="transcript-stat">
                  <span class="transcript-stat-label">Status</span>
                  <span class="transcript-stat-value">${this.getStatusLabel(call.status)}</span>
                </div>
              </div>
            `;
            fragment.appendChild(div);
          });

          container.innerHTML = '';
          container.appendChild(fragment);

          // Add delete handlers
          container.querySelectorAll('.transcript-call-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.remove(btn.dataset.id);
            });
          });

          // Click to call
          container.querySelectorAll('.transcript-call').forEach((item, index) => {
            item.addEventListener('click', () => {
              const number = this.calls[index].number;
              Softphone.dialNumber(number);
            });
          });
        },

        getTypeLabel(type) {
          const labels = {
            incoming: 'Recebida',
            outgoing: 'Realizada',
            missed: 'Perdida'
          };
          return labels[type] || type;
        },

        getStatusLabel(status) {
          const labels = {
            completed: 'Completada',
            missed: 'Perdida',
            rejected: 'Rejeitada',
            failed: 'Falhou'
          };
          return labels[status] || status;
        },

        export() {
          const data = {
            app: APP_NAME,
            version: VERSION,
            exportDate: new Date().toISOString(),
            config: {
              wss: this.dom.wss.value,
              user: this.dom.user.value,
              domain: this.dom.domain.value,
              pass: this.dom.pass.value
            },
            theme: Storage.get(STORAGE_KEYS.THEME, 'dark'),
            contacts: ContactsManager.contacts,
            history: CallHistory.calls,
            logs: this.logs.slice(-100)
          };

          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `softphone-wss-backup-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          this.log('Backup completo exportado (config, contatos, historico, tema)', LOG_TYPES.SUCCESS);
          this.toast('Backup exportado com sucesso', 'success');
        }
      };

      // ============================================
      // ============================================
      const SpeechManager = {
        recognition: null,
        isListening: false,
        isSupported: false,
        currentTranscript: [],
        interimText: '',

        init() {
          // Check browser support
          const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
          
          if (!SpeechRecognition) {
            this.isSupported = false;
            Softphone.log('Speech Recognition nao suportado neste navegador', LOG_TYPES.WARNING);
            this.updateStatus('Nao suportado', 'error');
            return;
          }

          this.isSupported = true;
          this.recognition = new SpeechRecognition();
          this.configureRecognition();
          
          Softphone.log('Speech Recognition inicializado', LOG_TYPES.SUCCESS);
          this.updateStatus('Transcricao desativada', '');
        },

configureRecognition() {
  const recog = this.recognition;

  recog.continuous = true;
  recog.interimResults = true;
  recog.lang = "pt-BR";
  recog.maxAlternatives = 1;

  // Estado seguro
  this.isListening = false;

  recog.onstart = () => {
    this.isListening = true;

    // Mantém sua UI original
    this.updateStatus("Ouvindo...", "active");
    this.updateButton(true);
    Utils.$("transcriptLiveDot").classList.add("active");

    Softphone.log("Transcricao iniciada", LOG_TYPES.INFO);
  };

  recog.onend = () => {
    this.isListening = false;

    // REINÍCIO SEGURO (sem "already started")
    if (Softphone.isInCall) {
      setTimeout(() => {
        if (!this.isListening) {
          try { recog.start(); } catch(e) {}
        }
      }, 150);
    } else {
      // Mantém UI original
      this.updateStatus("Transcricao pausada", "");
      this.updateButton(false);
      Utils.$("transcriptLiveDot").classList.remove("active");
    }
  };

  recog.onerror = (event) => {
    if (event.error === "no-speech") return;

    Softphone.log(`Erro SpeechRecognition: ${event.error}`, LOG_TYPES.ERROR);
    this.isListening = false;
  };

  recog.onresult = (event) => {
    const result = event.results[event.resultIndex];
    const text = result[0].transcript;

    // Mantém seu log
    Softphone.log(`Transcricao: ${text}`, LOG_TYPES.DEBUG);

    // Se quiser mandar para UI depois, posso te ajudar
  };
},


        start() {
          if (!this.isSupported) {
            Softphone.toast('Transcricao nao suportada', 'error');
            return;
          }

          if (this.isListening) return;

          try {
            this.recognition.start();
            this.showLivePanel();
          } catch (error) {
            Softphone.log(`Erro ao iniciar transcricao: ${error.message}`, LOG_TYPES.ERROR);
          }
        },

        stop() {
          if (!this.recognition) return;

          this.isListening = false;
          
          try {
            this.recognition.stop();
          } catch (e) {
            // Ignore
          }

          this.updateStatus('Transcricao pausada', '');
          this.updateButton(false);
          Utils.$('transcriptLiveDot').classList.remove('active');
        },

        toggle() {
          if (this.isListening) {
            this.stop();
          } else {
            this.start();
          }
        },

        addMessage(sender, text) {
          if (!text.trim()) return;

          const message = {
            id: Utils.generateId(),
            sender: sender, // 'you' or 'remote'
            text: text.trim(),
            time: new Date().toISOString()
          };

          this.currentTranscript.push(message);
          this.renderMessage(message);
          this.updateCount();

          Softphone.log(`Transcript [${sender}]: ${text}`, LOG_TYPES.DEBUG);
        },

        renderMessage(message) {
          const container = Utils.$('transcriptMessages');
          if (!container) return;

          // Remove interim message
          const interim = container.querySelector('.transcript-message.interim');
          if (interim) interim.remove();

          const div = document.createElement('div');
          div.className = `transcript-message ${message.sender}`;
          div.innerHTML = `
            <div class="transcript-message-header">
              <span class="transcript-message-sender ${message.sender}">${message.sender === 'you' ? 'Voce' : 'Remoto'}</span>
              <span class="transcript-message-time">${Utils.formatTime(new Date(message.time))}</span>
            </div>
            <div class="transcript-message-text">${Utils.escapeHtml(message.text)}</div>
          `;

          container.appendChild(div);
          container.scrollTop = container.scrollHeight;
        },

        renderInterimMessage(text) {
          const container = Utils.$('transcriptMessages');
          if (!container) return;

          // Remove existing interim
          const existing = container.querySelector('.transcript-message.interim');
          if (existing) existing.remove();

          const div = document.createElement('div');
          div.className = 'transcript-message you interim';
          div.innerHTML = `
            <div class="transcript-message-header">
              <span class="transcript-message-sender you">Voce</span>
              <span class="transcript-message-time">...</span>
            </div>
            <div class="transcript-message-text interim">${Utils.escapeHtml(text)}</div>
          `;

          container.appendChild(div);
          container.scrollTop = container.scrollHeight;
        },

        showLivePanel() {
          Utils.$('transcriptLive').style.display = 'block';
          Utils.$('transcriptEmpty').style.display = 'none';
          Utils.$('transcriptLiveNumber').textContent = Softphone.currentCallNumber || 'Chamada';
        },

        hideLivePanel() {
          Utils.$('transcriptLive').style.display = 'none';
        },

        saveCurrentTranscript() {
          if (this.currentTranscript.length === 0) return;

          const transcript = {
            id: Utils.generateId(),
            number: Softphone.currentCallNumber || 'Desconhecido',
            date: new Date().toISOString(),
            messages: [...this.currentTranscript],
            duration: Softphone.callStartTime ? 
              Math.floor((new Date() - Softphone.callStartTime) / 1000) : 0
          };

          TranscriptHistory.add(transcript);
          
          this.currentTranscript = [];
          Utils.$('transcriptMessages').innerHTML = '';
          
          Softphone.log(`Transcript salvo: ${transcript.messages.length} mensagens`, LOG_TYPES.SUCCESS);
        },

        updateStatus(text, className) {
          const statusEl = Utils.$('speechStatus');
          const textEl = Utils.$('speechStatusText');
          
          if (textEl) textEl.textContent = text;
          if (statusEl) {
            statusEl.className = 'speech-status';
            if (className) statusEl.classList.add(className);
          }
        },

        updateButton(isRecording) {
          const btn = Utils.$('btnToggleSpeech');
          const text = Utils.$('speechBtnText');
          
          if (btn) btn.classList.toggle('recording', isRecording);
          if (text) text.textContent = isRecording ? 'Parar' : 'Iniciar';
        },

        updateCount() {
          const countEl = Utils.$('transcriptCount');
          if (countEl) {
            const total = TranscriptHistory.transcripts.length + 
              (this.currentTranscript.length > 0 ? 1 : 0);
            countEl.textContent = total;
          }
        },

        clear() {
          this.currentTranscript = [];
          Utils.$('transcriptMessages').innerHTML = '';
          this.updateCount();
        },

        startForCall() {
          this.currentTranscript = [];
          Utils.$('transcriptMessages').innerHTML = '';
          this.showLivePanel();
          
          // Auto-start if supported
          if (this.isSupported) {
            this.start();
          }
        },

        endForCall() {
          this.stop();
          this.saveCurrentTranscript();
          this.hideLivePanel();
          
          // Check if should show empty state
          if (TranscriptHistory.transcripts.length === 0) {
            Utils.$('transcriptEmpty').style.display = 'flex';
          }
        }
      };

      // ============================================
      // ============================================
      const TranscriptHistory = {
        transcripts: [],
        MAX_TRANSCRIPTS: 50,

        init() {
          this.transcripts = Storage.get(STORAGE_KEYS.TRANSCRIPTS, []);
          this.render();
          SpeechManager.updateCount();
        },

        add(transcript) {
          this.transcripts.unshift(transcript);
          
          if (this.transcripts.length > this.MAX_TRANSCRIPTS) {
            this.transcripts = this.transcripts.slice(0, this.MAX_TRANSCRIPTS);
          }

          this.save();
          this.render();
          SpeechManager.updateCount();
        },

        remove(id) {
          this.transcripts = this.transcripts.filter(t => t.id !== id);
          this.save();
          this.render();
          SpeechManager.updateCount();
          
          if (this.transcripts.length === 0) {
            Utils.$('transcriptEmpty').style.display = 'flex';
          }
        },

        clear() {
          this.transcripts = [];
          this.save();
          this.render();
          SpeechManager.updateCount();
          Utils.$('transcriptEmpty').style.display = 'flex';
          Softphone.log('Transcripts limpos', LOG_TYPES.INFO);
        },

        save() {
          Storage.set(STORAGE_KEYS.TRANSCRIPTS, this.transcripts);
        },

        render() {
          const container = Utils.$('transcriptList');
          const emptyState = Utils.$('transcriptEmpty');
          
          if (!container) return;

          if (this.transcripts.length === 0) {
            container.innerHTML = '';
            if (emptyState && !SpeechManager.isListening) {
              emptyState.style.display = 'flex';
            }
            return;
          }

          if (emptyState) emptyState.style.display = 'none';

          const fragment = document.createDocumentFragment();

          this.transcripts.forEach(transcript => {
            const div = document.createElement('div');
            div.className = 'transcript-saved';
            
            const messagesHtml = transcript.messages.slice(0, 5).map(msg => `
              <div class="transcript-saved-message">
                <span class="transcript-saved-message-sender ${msg.sender}">${msg.sender === 'you' ? 'Voce' : 'Remoto'}:</span>
                ${Utils.escapeHtml(msg.text)}
              </div>
            `).join('');

            const moreCount = transcript.messages.length > 5 ? 
              `<div class="transcript-saved-message" style="color:var(--text-muted);font-style:italic;">... e mais ${transcript.messages.length - 5} mensagens</div>` : '';

            div.innerHTML = `
              <div class="transcript-saved-header">
                <div class="transcript-saved-info">
                  <span class="transcript-saved-number">${Utils.escapeHtml(transcript.number)}</span>
                  <span class="transcript-saved-date">${Utils.formatDate(new Date(transcript.date))} - ${Utils.formatDuration(transcript.duration)}</span>
                </div>
                <div class="transcript-saved-actions">
                  <button class="transcript-saved-btn copy" data-id="${transcript.id}" title="Copiar">
                    <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                  </button>
                  <button class="transcript-saved-btn delete" data-id="${transcript.id}" title="Remover">
                    <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                  </button>
                </div>
              </div>
              <div class="transcript-saved-content">
                ${messagesHtml}
                ${moreCount}
              </div>
            `;

            fragment.appendChild(div);
          });

          container.innerHTML = '';
          container.appendChild(fragment);

          // Bind events
          container.querySelectorAll('.transcript-saved-btn.copy').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const transcript = this.transcripts.find(t => t.id === btn.dataset.id);
              if (transcript) {
                const text = transcript.messages.map(m => 
                  `[${m.sender === 'you' ? 'Voce' : 'Remoto'}] ${m.text}`
                ).join('\n');
                
                navigator.clipboard.writeText(text).then(() => {
                  Softphone.toast('Transcript copiado', 'success');
                }).catch(() => {
                  Softphone.toast('Erro ao copiar', 'error');
                });
              }
            });
          });

          container.querySelectorAll('.transcript-saved-btn.delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (confirm('Remover este transcript?')) {
                this.remove(btn.dataset.id);
              }
            });
          });
        },

        export() {
          const data = {
            app: APP_NAME,
            version: VERSION,
            exportDate: new Date().toISOString(),
            transcripts: this.transcripts
          };

          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `transcripts-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          Softphone.log('Transcripts exportados', LOG_TYPES.SUCCESS);
          Softphone.toast('Transcripts exportados', 'success');
        }
      };

      // ============================================
      // MAIN SOFTPHONE MODULE
      // ============================================
      const Softphone = {
        ua: null,
        session: null,
        isRegistered: false,
        isInCall: false,
        callStartTime: null,
        callTimerInterval: null,
        currentCallNumber: '',
        currentCallType: 'outgoing',
        logs: [],
        logCount: 0,
        dom: {},

        init: ErrorHandler.wrap(function() {
          this.cacheDom();
          this.loadTheme();
          this.loadConfig();
          this.loadLogs();
          this.bindEvents();
          this.checkCreditsPopup();
          CallHistory.init();
          ContactsManager.init();
          TranscriptHistory.init(); // Initialize transcript history
          SpeechManager.init(); // Initialize speech recognition

          if (checkJsSIP()) {
            this.log(`${APP_NAME} v${VERSION} inicializado`, LOG_TYPES.SUCCESS);
            this.log(`JsSIP v${jsSIPVersion} carregado`, LOG_TYPES.INFO);
          } else {
            this.log(`[${ERROR_CODES.JSSIP_NOT_LOADED}] JsSIP nao carregado - verificando...`, LOG_TYPES.WARNING);
            setTimeout(() => {
              if (checkJsSIP()) {
                this.log(`JsSIP v${jsSIPVersion} carregado com sucesso`, LOG_TYPES.SUCCESS);
              } else {
                this.log(`[${ERROR_CODES.JSSIP_NOT_LOADED}] Falha ao carregar JsSIP`, LOG_TYPES.ERROR);
              }
            }, 2000);
          }

          window.addEventListener('online', () => {
            this.log('Conexao de rede restabelecida', LOG_TYPES.SUCCESS);
            this.toast('Conectado a internet', 'success');
          });

          window.addEventListener('offline', () => {
            this.log(`[${ERROR_CODES.NETWORK}] Conexao de rede perdida`, LOG_TYPES.ERROR);
            this.toast('Sem conexao com a internet', 'error');
          });

        }, 'Softphone.init'),

        cacheDom() {
          this.dom = {
            statusDot: Utils.$('statusDot'),
            statusText: Utils.$('statusText'),
            statusUser: Utils.$('statusUser'),
            dialerNumber: Utils.$('dialerNumber'),
            dialerStatus: Utils.$('dialerStatus'),
            callTimer: Utils.$('callTimer'),
            voiceAnimation: Utils.$('voiceAnimation'),
            networkStats: Utils.$('networkStats'),
            btnCall: Utils.$('btnCall'),
            btnHangup: Utils.$('btnHangup'),
            btnClear: Utils.$('btnClear'),
            btnRegister: Utils.$('btnRegister'),
            btnRegisterText: Utils.$('btnRegisterText'),
            wss: Utils.$('wss'),
            user: Utils.$('user'),
            domain: Utils.$('domain'),
            pass: Utils.$('pass'),
            logArea: Utils.$('logArea'),
            logCount: Utils.$('logCount'),
            incomingModal: Utils.$('incomingModal'),
            callerNumber: Utils.$('callerNumber'),
            toast: Utils.$('toast'),
            remoteAudio: Utils.$('remoteAudio'),
            creditsPopup: Utils.$('creditsPopup'),
            contactsSearch: Utils.$('contactsSearch'),
            contactName: Utils.$('contactName'),
            contactNumber: Utils.$('contactNumber'),
            btnSaveContacts: Utils.$('btnSaveContacts'), // Added btnSaveContacts
            // Transcript DOM elements
            btnToggleSpeech: Utils.$('btnToggleSpeech'),
            speechBtnText: Utils.$('speechBtnText'),
            speechStatus: Utils.$('speechStatus'),
            speechStatusText: Utils.$('speechStatusText'),
            transcriptLive: Utils.$('transcriptLive'),
            transcriptLiveDot: Utils.$('transcriptLiveDot'),
            transcriptLiveNumber: Utils.$('transcriptLiveNumber'),
            transcriptMessages: Utils.$('transcriptMessages'),
            transcriptEmpty: Utils.$('transcriptEmpty'),
            transcriptList: Utils.$('transcriptList'),
            transcriptCount: Utils.$('transcriptCount'),
            btnExportTranscript: Utils.$('btnExportTranscript'),
            btnClearTranscript: Utils.$('btnClearTranscript')
          };
        },

        bindEvents() {
          // Tabs
          document.querySelector('.tabs').addEventListener('click', (e) => {
            const tab = e.target.closest('.tab');
            if (tab) this.switchTab(tab.dataset.tab);
          });

          // Theme
          document.querySelector('.theme-switcher').addEventListener('click', (e) => {
            const btn = e.target.closest('.theme-btn');
            if (btn) this.setTheme(btn.dataset.theme);
          });

          // Keypad
          document.querySelector('.keypad').addEventListener('click', (e) => {
            const key = e.target.closest('.key');
            if (key) this.pressKey(key.dataset.key);
          });

          // Control buttons
          this.dom.btnCall.addEventListener('click', () => this.call());
          this.dom.btnHangup.addEventListener('click', () => this.hangup());
          this.dom.btnClear.addEventListener('click', () => this.clearNumber());
          this.dom.btnRegister.addEventListener('click', () => this.toggleRegistration());

          // Config inputs
          const saveConfig = Utils.debounce(() => this.saveConfig(), SAVE_DEBOUNCE_MS);
          [this.dom.wss, this.dom.user, this.dom.domain, this.dom.pass].forEach(input => {
            input.addEventListener('input', saveConfig);
          });

          // Export/Import
          Utils.$('btnExport').addEventListener('click', () => this.exportConfig());
          Utils.$('btnImport').addEventListener('click', () => Utils.$('fileImport').click());
          Utils.$('fileImport').addEventListener('change', (e) => this.importConfig(e));

          // Log
          Utils.$('btnClearLog').addEventListener('click', () => this.clearLogs());

          // History
          Utils.$('btnClearHistory').addEventListener('click', () => {
            if (confirm('Limpar todo o historico de chamadas?')) {
              CallHistory.clear();
              this.toast('Historico limpo', 'success');
            }
          });
          Utils.$('btnExportHistory').addEventListener('click', () => CallHistory.export());

          // Contacts
          this.dom.contactsSearch.addEventListener('input', (e) => {
            ContactsManager.search(e.target.value);
          });

          Utils.$('btnAddContact').addEventListener('click', () => {
            const name = this.dom.contactName.value.trim();
            const number = this.dom.contactNumber.value.trim();
            
            if (ContactsManager.add(name, number)) {
              this.dom.contactName.value = '';
              this.dom.contactNumber.value = '';
            }
          });

          this.dom.btnSaveContacts.addEventListener('click', () => {
            ContactsManager.save();
            this.log('Contatos salvos no storage local', LOG_TYPES.SUCCESS);
            this.toast('Contatos salvos', 'success');
          });

          // Incoming call modal
          Utils.$('btnAnswer').addEventListener('click', () => this.answerCall());
          Utils.$('btnReject').addEventListener('click', () => this.rejectCall());

          // Credits
          Utils.$('closeCreditsBtn').addEventListener('click', () => this.closeCredits());

          // Keyboard
          document.addEventListener('keydown', (e) => this.handleKeyboard(e));

          this.dom.btnToggleSpeech.addEventListener('click', () => SpeechManager.toggle());
          this.dom.btnExportTranscript.addEventListener('click', () => TranscriptHistory.export());
          this.dom.btnClearTranscript.addEventListener('click', () => {
            if (confirm('Limpar todos os transcripts?')) {
              TranscriptHistory.clear();
              SpeechManager.clear();
              this.toast('Transcripts limpos', 'success');
            }
          });
        },

        switchTab(tabId) {
          Utils.$$('.tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tabId);
            t.setAttribute('aria-selected', t.dataset.tab === tabId);
          });
          
          Utils.$$('.panel').forEach(p => {
            p.classList.toggle('active', p.id === `panel-${tabId}`);
          });
        },

        setTheme(theme) {
          document.documentElement.setAttribute('data-theme', theme);
          
          Utils.$$('.theme-btn').forEach(btn => {
            const isActive = btn.dataset.theme === theme;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', isActive);
          });

          Storage.set(STORAGE_KEYS.THEME, theme);
          this.log(`Tema alterado: ${theme}`, LOG_TYPES.DEBUG);
        },

        loadTheme() {
          const theme = Storage.get(STORAGE_KEYS.THEME, 'dark');
          this.setTheme(theme);
        },

        loadConfig() {
          const config = Storage.get(STORAGE_KEYS.CONFIG, {});
          
          if (config.wss) this.dom.wss.value = config.wss;
          if (config.user) this.dom.user.value = config.user;
          if (config.domain) this.dom.domain.value = config.domain;
          if (config.pass) this.dom.pass.value = config.pass;

          this.log('Configuracoes carregadas do storage', LOG_TYPES.DEBUG);
        },

        saveConfig() {
          const config = {
            wss: this.dom.wss.value.trim(),
            user: this.dom.user.value.trim(),
            domain: this.dom.domain.value.trim(),
            pass: this.dom.pass.value
          };

          Storage.set(STORAGE_KEYS.CONFIG, config);
        },

        validateConfig() {
          let isValid = true;
          const errors = [];

          [this.dom.wss, this.dom.user, this.dom.domain, this.dom.pass].forEach(el => {
            el.classList.remove('error');
          });

          if (!this.dom.wss.value.trim()) {
            this.dom.wss.classList.add('error');
            errors.push('Servidor WSS e obrigatorio');
            isValid = false;
          } else if (!Utils.isValidWSS(this.dom.wss.value.trim())) {
            this.dom.wss.classList.add('error');
            errors.push('URL WSS invalida');
            isValid = false;
          }

          if (!this.dom.user.value.trim()) {
            this.dom.user.classList.add('error');
            errors.push('Usuario e obrigatorio');
            isValid = false;
          }

          if (!this.dom.domain.value.trim()) {
            this.dom.domain.classList.add('error');
            errors.push('Dominio e obrigatorio');
            isValid = false;
          } else if (!Utils.isValidDomain(this.dom.domain.value.trim())) {
            this.dom.domain.classList.add('error');
            errors.push('Dominio invalido');
            isValid = false;
          }

          if (!this.dom.pass.value) {
            this.dom.pass.classList.add('error');
            errors.push('Senha e obrigatoria');
            isValid = false;
          }

          if (!isValid) {
            errors.forEach(err => this.log(`[${ERROR_CODES.VALIDATION}] ${err}`, LOG_TYPES.ERROR));
            this.toast(errors[0], 'error');
          }

          return isValid;
        },

        exportConfig() {
          const data = {
            app: APP_NAME,
            version: VERSION,
            exportDate: new Date().toISOString(),
            config: {
              wss: this.dom.wss.value,
              user: this.dom.user.value,
              domain: this.dom.domain.value,
              pass: this.dom.pass.value
            },
            theme: Storage.get(STORAGE_KEYS.THEME, 'dark'),
            contacts: ContactsManager.contacts,
            history: CallHistory.calls,
            transcripts: TranscriptHistory.transcripts, // Include transcripts
            logs: this.logs.slice(-100)
          };

          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `softphone-wss-backup-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          this.log('Backup completo exportado (config, contatos, historico, tema)', LOG_TYPES.SUCCESS);
          this.toast('Backup exportado com sucesso', 'success');
        },

        importConfig(e) {
          const file = e.target.files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const data = JSON.parse(event.target.result);
              
              let imported = [];

              if (data.config) {
                if (data.config.wss) this.dom.wss.value = data.config.wss;
                if (data.config.user) this.dom.user.value = data.config.user;
                if (data.config.domain) this.dom.domain.value = data.config.domain;
                if (data.config.pass) this.dom.pass.value = data.config.pass;
                this.saveConfig();
                imported.push('configuracoes');
              }

              if (data.theme) {
                this.setTheme(data.theme);
                imported.push('tema');
              }

              if (data.contacts && Array.isArray(data.contacts)) {
                ContactsManager.contacts = data.contacts;
                ContactsManager.save();
                ContactsManager.render();
                ContactsManager.renderFavorites();
                ContactsManager.updateCounts();
                imported.push(`${data.contacts.length} contatos`);
              }

              if (data.history && Array.isArray(data.history)) {
                CallHistory.calls = data.history;
                CallHistory.save();
                CallHistory.render();
                CallHistory.updateCount();
                imported.push(`${data.history.length} chamadas`);
              }
              
              if (data.transcripts && Array.isArray(data.transcripts)) {
                TranscriptHistory.transcripts = data.transcripts;
                TranscriptHistory.save();
                TranscriptHistory.render();
                SpeechManager.updateCount();
                imported.push(`${data.transcripts.length} transcripts`);
              }

              const importSummary = imported.join(', ');
              this.log(`Backup importado: ${importSummary}`, LOG_TYPES.SUCCESS);
              this.toast('Backup importado com sucesso', 'success');

            } catch (error) {
              this.log(`[${ERROR_CODES.STORAGE}] Erro ao importar: ${error.message}`, LOG_TYPES.ERROR);
              this.toast('Erro ao importar arquivo', 'error');
            }
          };

          reader.onerror = () => {
            this.log(`[${ERROR_CODES.STORAGE}] Erro ao ler arquivo`, LOG_TYPES.ERROR);
            this.toast('Erro ao ler arquivo', 'error');
          };

          reader.readAsText(file);
          e.target.value = '';
        },

        dialNumber(number) {
          this.dom.dialerNumber.textContent = number;
          this.dom.btnCall.disabled = false;
          this.switchTab('dialer');
          this.log(`Numero discado: ${number}`, LOG_TYPES.DEBUG);
        },

        pressKey(key) {
          if (!key) return;

          const current = this.dom.dialerNumber.textContent.trim();
          const newNumber = (current === '' || current === '\u00A0') ? key : current + key;
          
          this.dom.dialerNumber.textContent = newNumber;
          this.dom.btnCall.disabled = false;

          if (this.isInCall && this.session) {
            try {
              this.session.sendDTMF(key);
              this.log(`DTMF enviado: ${key}`, LOG_TYPES.DEBUG);
            } catch (error) {
              this.log(`Erro ao enviar DTMF: ${error.message}`, LOG_TYPES.WARNING);
            }
          }
        },

        clearNumber() {
          const current = this.dom.dialerNumber.textContent.trim();
          
          if (current.length > 1) {
            this.dom.dialerNumber.textContent = current.slice(0, -1);
          } else {
            this.dom.dialerNumber.innerHTML = '&nbsp;';
            this.dom.btnCall.disabled = true;
          }
        },

        handleKeyboard(e) {
          if (e.target.tagName === 'INPUT') return;

          const key = e.key;

          if (/^[0-9*#]$/.test(key)) {
            e.preventDefault();
            this.pressKey(key);
          } else if (key === 'Backspace') {
            e.preventDefault();
            this.clearNumber();
          } else if (key === 'Enter' && !this.dom.btnCall.disabled) {
            e.preventDefault();
            this.call();
          } else if (key === 'Escape' && this.isInCall) {
            e.preventDefault();
            this.hangup();
          }
        },

        toggleRegistration() {
          if (this.isRegistered) {
            this.unregister();
          } else {
            this.register();
          }
        },

        register: ErrorHandler.wrap(function() {
          if (!checkJsSIP()) {
            this.log(`[${ERROR_CODES.JSSIP_NOT_LOADED}] JsSIP nao esta carregado`, LOG_TYPES.ERROR);
            this.toast('Biblioteca SIP nao carregada', 'error');
            return;
          }

          if (!this.validateConfig()) return;

          this.setStatus('connecting', 'Conectando...');
          this.log('Iniciando conexao SIP...', LOG_TYPES.INFO);

          const wss = this.dom.wss.value.trim();
          const user = this.dom.user.value.trim();
          const domain = this.dom.domain.value.trim();
          const pass = this.dom.pass.value;

          const socket = new JsSIP.WebSocketInterface(wss);

          const config = {
            sockets: [socket],
            uri: `sip:${user}@${domain}`,
            password: pass,
            display_name: user,
            register: true,
            session_timers: false,
            connection_recovery_min_interval: 2,
            connection_recovery_max_interval: 30
            // register_extra_headers:[
            //   'Os menorzin v1.0'
            // ]

          };

          this.log(`Conectando a ${wss}`, LOG_TYPES.INFO);
          this.log(`URI: sip:${user}@${domain}`, LOG_TYPES.DEBUG);

          try {
            this.ua = new JsSIP.UA(config);
            this.setupUAEvents();
            this.ua.start();
          } catch (error) {
            this.log(`[${ERROR_CODES.CONNECTION}] Erro ao criar UA: ${error.message}`, LOG_TYPES.ERROR);
            this.setStatus('offline', 'Erro de conexao');
            this.toast('Erro ao conectar', 'error');
          }

        }, 'Softphone.register'),

        unregister() {
          if (!this.ua) return;

          this.log('Desconectando...', LOG_TYPES.INFO);
          
          try {
            this.ua.stop();
          } catch (error) {
            this.log(`Erro ao desconectar: ${error.message}`, LOG_TYPES.WARNING);
          }

          this.ua = null;
          this.isRegistered = false;
          this.setStatus('offline', 'Desconectado');
          this.dom.btnRegisterText.textContent = 'Conectar';
          this.dom.statusUser.textContent = '-';
          this.log('Desconectado com sucesso', LOG_TYPES.SUCCESS);
        },

        setupUAEvents() {
          this.ua.on('connected', () => {
            this.log('WebSocket conectado', LOG_TYPES.SUCCESS);
          });

          this.ua.on('disconnected', () => {
            this.log('WebSocket desconectado', LOG_TYPES.WARNING);
            this.isRegistered = false;
            this.setStatus('offline', 'Desconectado');
            this.dom.btnRegisterText.textContent = 'Conectar';
          });

          this.ua.on('registered', () => {
            this.isRegistered = true;
            this.setStatus('online', 'Registrado');
            this.dom.btnRegisterText.textContent = 'Desconectar';
            this.dom.statusUser.textContent = this.dom.user.value;
            this.log('Registrado com sucesso no servidor SIP', LOG_TYPES.SUCCESS);
            this.toast('Conectado', 'success');
          });

          this.ua.on('unregistered', () => {
            this.isRegistered = false;
            this.setStatus('offline', 'Desconectado');
            this.dom.btnRegisterText.textContent = 'Conectar';
            this.log('Registro removido', LOG_TYPES.INFO);
          });

          this.ua.on('registrationFailed', (e) => {
            const cause = e.cause || 'Desconhecido';
            const statusCode = e.response?.status_code;
            const errorMsg = statusCode ? ErrorHandler.getSIPErrorMessage(statusCode) : cause;
            
            this.isRegistered = false;
            this.setStatus('offline', 'Falha no registro');
            this.dom.btnRegisterText.textContent = 'Conectar';
            this.log(`[${ERROR_CODES.REGISTRATION}] Falha no registro: ${errorMsg}`, LOG_TYPES.ERROR);
            this.toast(`Falha: ${errorMsg}`, 'error');
          });

          this.ua.on('newRTCSession', (e) => {
            const session = e.session;
            
            session.on('sdp', (ev) => {
              if (ev.originator === 'remote') return;
              try {
                const request = session._request || session.request;
                if (request && request.headers) {
                  delete request.headers['Session-Expires'];
                  delete request.headers['Min-SE'];
                  delete request.headers['timer'];
                }
              } catch (err) {
                // Silently ignore
              }
            });

            if (e.originator === 'remote') {
              this.handleIncomingCall(session);
            } else {
              this.setupSessionEvents(session);
            }
          });
        },

        call: ErrorHandler.wrap(function() {
          const number = Utils.sanitizeNumber(this.dom.dialerNumber.textContent);
          
          if (!number) {
            this.toast('Digite um numero', 'warning');
            return;
          }

          if (!this.isRegistered) {
            this.toast('Conecte-se primeiro', 'warning');
            return;
          }

          if (this.isInCall) {
            this.toast('Ja existe uma chamada em andamento', 'warning');
            return;
          }

          this.log(`Iniciando chamada para ${number}...`, LOG_TYPES.INFO);
          this.currentCallNumber = number;
          this.currentCallType = 'outgoing';

          const domain = this.dom.domain.value.trim();
          const target = `sip:${number}@${domain}`;

          const options = {
            mediaConstraints: { audio: true, video: false },
            rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
            sessionTimersExpires: 0,
            pcConfig: {
              iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
              ]
            }
          };

          try {
            this.session = this.ua.call(target, options);
            this.setupSessionEvents(this.session);
          } catch (error) {
            this.log(`[${ERROR_CODES.CALL}] Erro ao iniciar chamada: ${error.message}`, LOG_TYPES.ERROR);
            this.toast('Erro ao iniciar chamada', 'error');
          }

        }, 'Softphone.call'),

        hangup() {
          if (!this.session) return;

          this.log('Encerrando chamada...', LOG_TYPES.INFO);

          try {
            this.session.terminate();
          } catch (error) {
            this.log(`Erro ao encerrar: ${error.message}`, LOG_TYPES.WARNING);
          }
        },

        handleIncomingCall(session) {
          const caller = session.remote_identity?.uri?.user || 'Desconhecido';
          
          this.session = session;
          this.currentCallNumber = caller;
          this.currentCallType = 'incoming';
          
          this.log(`Chamada recebida de ${caller}`, LOG_TYPES.INFO);
          
          this.dom.callerNumber.textContent = caller;
          this.dom.incomingModal.classList.add('active');

          this.setupSessionEvents(session);

          session.on('failed', () => {
            this.dom.incomingModal.classList.remove('active');
          });

          session.on('ended', () => {
            this.dom.incomingModal.classList.remove('active');
          });
        },

        answerCall() {
          if (!this.session) return;

          this.log('Atendendo chamada...', LOG_TYPES.INFO);
          this.dom.incomingModal.classList.remove('active');

          const options = {
            mediaConstraints: { audio: true, video: false }
          };

          try {
            this.session.answer(options);
          } catch (error) {
            this.log(`[${ERROR_CODES.CALL}] Erro ao atender: ${error.message}`, LOG_TYPES.ERROR);
            this.toast('Erro ao atender chamada', 'error');
          }
        },

        rejectCall() {
          if (!this.session) return;

          this.log('Rejeitando chamada...', LOG_TYPES.INFO);
          this.dom.incomingModal.classList.remove('active');

          try {
            this.session.terminate({ status_code: 486 });
            
            CallHistory.add({
              number: this.currentCallNumber,
              type: 'missed',
              status: 'rejected',
              duration: 0
            });
          } catch (error) {
            this.log(`Erro ao rejeitar: ${error.message}`, LOG_TYPES.WARNING);
          }
        },

        setupSessionEvents(session) {
          session.on('connecting', () => {
            this.log('Conectando chamada...', LOG_TYPES.INFO);
            this.setDialerStatus('Conectando...');
          });

          session.on('progress', (e) => {
            const status = e.response?.status_code;
            if (status === 180 || status === 183) {
              this.log('Chamando... (ring)', LOG_TYPES.INFO);
              this.setDialerStatus('Chamando...');
            }
          });

          session.on('accepted', () => {
            this.log('Chamada atendida', LOG_TYPES.SUCCESS);
            this.setDialerStatus('Em chamada');
          });

          session.on('confirmed', () => {
            this.isInCall = true;
            this.callStartTime = new Date();
            this.startCallTimer();
            this.dom.voiceAnimation.classList.add('active');
            this.dom.btnCall.disabled = true;
            this.dom.btnHangup.disabled = false;
            this.log('Chamada confirmada - audio ativo', LOG_TYPES.SUCCESS);
            
            SpeechManager.startForCall();
          });

          session.on('ended', (e) => {
            const cause = e.cause || 'Normal';
            this.endCall(`Chamada encerrada (${cause})`);
          });

          session.on('failed', (e) => {
            const cause = e.cause || 'Desconhecido';
            const statusCode = e.message?.status_code;
            const errorMsg = statusCode ? ErrorHandler.getSIPErrorMessage(statusCode) : cause;
            
            this.log(`[${ERROR_CODES.CALL}] Chamada falhou: ${errorMsg}`, LOG_TYPES.ERROR);
            
            const callDuration = this.callStartTime ? 
              Math.floor((new Date() - this.callStartTime) / 1000) : 0;
            
            CallHistory.add({
              number: this.currentCallNumber,
              type: this.currentCallType,
              status: 'failed',
              duration: callDuration
            });

            this.endCall(`Falha: ${errorMsg}`);
          });

          session.on('peerconnection', (e) => {
            const pc = e.peerconnection;
            
            // Start network stats monitoring
            NetworkStats.start(pc);
            
            pc.addEventListener('track', (event) => {
              this.log('Stream de audio recebido', LOG_TYPES.DEBUG);
              if (event.streams && event.streams[0]) {
                this.dom.remoteAudio.srcObject = event.streams[0];
                this.dom.remoteAudio.play().catch(err => {
                  this.log(`Erro ao reproduzir audio: ${err.message}`, LOG_TYPES.WARNING);
                });
              }
            });

            pc.addEventListener('iceconnectionstatechange', () => {
              this.log(`ICE state: ${pc.iceConnectionState}`, LOG_TYPES.DEBUG);
            });
          });
        },

        endCall(message) {
          SpeechManager.endForCall();

          const duration = this.callStartTime ? 
            Math.floor((new Date() - this.callStartTime) / 1000) : 0;

          if (this.currentCallNumber && this.callStartTime) {
            CallHistory.add({
              number: this.currentCallNumber,
              type: this.currentCallType,
              status: 'completed',
              duration: duration,
              startTime: this.callStartTime.toISOString()
            });
          }

          this.isInCall = false;
          this.session = null;
          this.callStartTime = null;
          this.currentCallNumber = '';
          
          this.stopCallTimer();
          NetworkStats.stop();
          this.dom.voiceAnimation.classList.remove('active');
          this.dom.btnCall.disabled = this.dom.dialerNumber.textContent.trim() === '' || 
                                      this.dom.dialerNumber.textContent.trim() === '\u00A0';
          this.dom.btnHangup.disabled = true;
          this.dom.remoteAudio.srcObject = null;
          
          this.log(message, LOG_TYPES.INFO);
          this.setDialerStatus('Digite o numero');

          setTimeout(() => {
            if (!this.isInCall) {
              this.dom.callTimer.classList.remove('active');
            }
          }, STATUS_RESET_DELAY);
        },

        startCallTimer() {
          this.dom.callTimer.classList.add('active');
          this.dom.callTimer.textContent = '00:00';

          this.callTimerInterval = setInterval(() => {
            if (!this.callStartTime) return;
            const elapsed = Math.floor((new Date() - this.callStartTime) / 1000);
            this.dom.callTimer.textContent = Utils.formatDuration(elapsed);
          }, 1000);
        },

        stopCallTimer() {
          if (this.callTimerInterval) {
            clearInterval(this.callTimerInterval);
            this.callTimerInterval = null;
          }
        },

        setStatus(status, text) {
          this.dom.statusDot.className = `status-dot ${status}`;
          this.dom.statusText.textContent = text;
        },

        setDialerStatus(text) {
          this.dom.dialerStatus.textContent = text;
        },

        log(message, type = LOG_TYPES.INFO) {
          const entry = {
            time: Utils.formatTime(new Date()),
            type: type,
            message: message
          };

          this.logs.push(entry);
          this.logCount++;

          if (this.logs.length > MAX_LOGS) {
            this.logs = this.logs.slice(-MAX_LOGS);
          }

          this.renderLogEntry(entry);
          this.dom.logCount.textContent = this.logCount;

          const prefix = `[${APP_NAME}]`;
          switch (type) {
            case LOG_TYPES.ERROR:
              console.error(prefix, message);
              break;
            case LOG_TYPES.WARNING:
              console.warn(prefix, message);
              break;
            case LOG_TYPES.SUCCESS:
              console.log(`%c${prefix} ${message}`, 'color: #10b981');
              break;
            default:
              console.log(prefix, message);
          }

          this.debouncedSaveLogs();
        },

        debouncedSaveLogs: Utils.debounce(function() {
          Storage.set(STORAGE_KEYS.LOGS, this.logs.slice(-100));
        }, 2000),

        renderLogEntry(entry) {
          const typeLabels = {
            [LOG_TYPES.INFO]: 'INFO',
            [LOG_TYPES.SUCCESS]: 'OK',
            [LOG_TYPES.WARNING]: 'WARN',
            [LOG_TYPES.ERROR]: 'ERR',
            [LOG_TYPES.DEBUG]: 'DBG'
          };

          const div = document.createElement('div');
          div.className = 'log-entry';
          div.innerHTML = `
            <span class="log-time">${entry.time}</span>
            <span class="log-type ${entry.type}">${typeLabels[entry.type] || 'INFO'}</span>
            <span class="log-msg ${entry.type}">${Utils.escapeHtml(entry.message)}</span>
          `;

          this.dom.logArea.appendChild(div);

          requestAnimationFrame(() => {
            this.dom.logArea.scrollTop = this.dom.logArea.scrollHeight;
          });
        },

        loadLogs() {
          const saved = Storage.get(STORAGE_KEYS.LOGS, []);
          saved.forEach(entry => {
            this.logs.push(entry);
            this.logCount++;
            this.renderLogEntry(entry);
          });
          this.dom.logCount.textContent = this.logCount;
        },

        clearLogs() {
          this.logs = [];
          this.logCount = 0;
          this.dom.logArea.innerHTML = '';
          this.dom.logCount.textContent = '0';
          Storage.remove(STORAGE_KEYS.LOGS);
          this.log('Logs limpos', LOG_TYPES.INFO);
        },

        toast(message, type = 'info') {
          this.dom.toast.textContent = message;
          this.dom.toast.className = `toast ${type}`;
          
          requestAnimationFrame(() => {
            this.dom.toast.classList.add('show');
          });

          setTimeout(() => {
            this.dom.toast.classList.remove('show');
          }, TOAST_DURATION);
        },

        checkCreditsPopup() {
          const closed = Storage.get(STORAGE_KEYS.CREDITS_CLOSED, false);
          if (closed) {
            this.dom.creditsPopup.classList.add('hidden');
          }
        },

        closeCredits() {
          this.dom.creditsPopup.classList.add('hidden');
          Storage.set(STORAGE_KEYS.CREDITS_CLOSED, true);
        }
      };

      // ============================================
      // GLOBAL ERROR HANDLERS
      // ============================================
      window.addEventListener('error', (e) => {
        ErrorHandler.handle(e.error || e.message, 'Erro Global');
      });

      window.addEventListener('unhandledrejection', (e) => {
        ErrorHandler.handle(e.reason, 'Promise Rejeitada');
      });

      // ============================================
      // INITIALIZE
      // ============================================
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => Softphone.init());
      } else {
        Softphone.init();
      }

      // Expose for debugging
      window.Softphone = Softphone;
      window.CallHistory = CallHistory;
      window.ContactsManager = ContactsManager;
      window.NetworkStats = NetworkStats;
      window.SpeechManager = SpeechManager; // Expose SpeechManager
      window.TranscriptHistory = TranscriptHistory; // Expose TranscriptHistory

    })();
  
    