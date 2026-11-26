/**
 * WebRTC and Signaling Abstraction Client Helper
 * Provides seamless WebRTC communication using either Firebase Realtime Database
 * or serverless HTTP polling fallback.
 */

export class SignalingClient {
  constructor({ sessionId, role = 'visitor', onRemoteStream, onConnectionStateChange, onSignalingStateChange }) {
    this.sessionId = sessionId;
    this.role = role; // 'visitor' or 'admin'
    this.onRemoteStream = onRemoteStream;
    this.onConnectionStateChange = onConnectionStateChange;
    this.onSignalingStateChange = onSignalingStateChange;

    this.peerConnection = null;
    this.localStream = null;
    this.iceCandidatesQueue = [];
    this.isRemoteDescriptionSet = false;
    this.pollInterval = null;
    this.firebaseApp = null;
    this.firebaseDb = null;
    this.iceServers = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
    ];
    this.useFirebase = false;
  }

  /**
   * Initializes WebRTC configuration (fetches ICE servers and Firebase configuration)
   */
  async init() {
    try {
      const res = await fetch('/api/webrtc/config');
      if (res.ok) {
        const config = await res.json();
        if (config.iceServers && config.iceServers.length > 0) {
          this.iceServers = config.iceServers;
        }

        // Check if Firebase is available and configured
        if (config.useFirebaseSignaling && config.firebase && window.firebase) {
          try {
            if (!firebase.apps.length) {
              this.firebaseApp = firebase.initializeApp(config.firebase);
            } else {
              this.firebaseApp = firebase.app();
            }
            this.firebaseDb = firebase.database();
            this.useFirebase = true;
            console.log('[Signaling] Initialized Firebase Realtime Database signaling');
          } catch (fbErr) {
            console.warn('[Signaling] Firebase init error, falling back to REST signaling:', fbErr);
            this.useFirebase = false;
          }
        }
      }
    } catch (err) {
      console.warn('[Signaling] Could not fetch WebRTC config, using default STUN:', err);
    }
  }

  /**
   * Creates RTCPeerConnection and attaches local stream tracks
   */
  createPeerConnection(localStream = null) {
    if (this.peerConnection) {
      this.closePeerConnection();
    }

    this.localStream = localStream;
    this.isRemoteDescriptionSet = false;
    this.iceCandidatesQueue = [];

    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    // Add local tracks if streaming
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // Handle incoming remote media tracks (e.g. for admin viewing stream)
    this.peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Received remote track:', event.track.kind);
      if (this.onRemoteStream && event.streams && event.streams[0]) {
        this.onRemoteStream(event.streams[0]);
      }
    };

    // Handle local ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendIceCandidate(event.candidate);
      }
    };

    // Monitor connection states
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log('[WebRTC] Connection state changed:', state);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(state);
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE connection state:', this.peerConnection.iceConnectionState);
    };

    return this.peerConnection;
  }

  /**
   * Sends an ICE candidate to the other peer via Firebase or API
   */
  async sendIceCandidate(candidate) {
    const target = this.role === 'visitor' ? 'admin' : 'visitor';

    if (this.useFirebase && this.firebaseDb) {
      try {
        const path = `sessions/${this.sessionId}/signaling/candidatesTo${target.charAt(0).toUpperCase() + target.slice(1)}`;
        await this.firebaseDb.ref(path).push(candidate.toJSON());
        return;
      } catch (err) {
        console.warn('[Firebase Signaling] Error sending ICE candidate:', err);
      }
    }

    // Fallback: REST API
    try {
      await fetch('/api/signaling/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          candidate: candidate.toJSON(),
          target
        })
      });
    } catch (err) {
      console.error('[Signaling] Failed to send ICE candidate:', err);
    }
  }

  /**
   * Visitor creates SDP Offer and sends it
   */
  async createAndSendOffer() {
    if (!this.peerConnection) return null;

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: this.role === 'admin',
      offerToReceiveVideo: this.role === 'admin'
    });

    await this.peerConnection.setLocalDescription(offer);

    if (this.useFirebase && this.firebaseDb) {
      await this.firebaseDb.ref(`sessions/${this.sessionId}/signaling/offer`).set({
        type: offer.type,
        sdp: offer.sdp
      });
    } else {
      await fetch('/api/signaling/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          offer: { type: offer.type, sdp: offer.sdp }
        })
      });
    }

    return offer;
  }

  /**
   * Receiver creates SDP Answer and sends it
   */
  async createAndSendAnswer(remoteOffer) {
    if (!this.peerConnection) return null;

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(remoteOffer));
    this.isRemoteDescriptionSet = true;
    this.processQueuedCandidates();

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    if (this.useFirebase && this.firebaseDb) {
      await this.firebaseDb.ref(`sessions/${this.sessionId}/signaling/answer`).set({
        type: answer.type,
        sdp: answer.sdp
      });
    } else {
      await fetch('/api/signaling/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          answer: { type: answer.type, sdp: answer.sdp }
        })
      });
    }

    return answer;
  }

  /**
   * Sets remote description when answer is received
   */
  async handleRemoteAnswer(remoteAnswer) {
    if (!this.peerConnection) return;
    if (this.peerConnection.signalingState === 'have-local-offer') {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(remoteAnswer));
      this.isRemoteDescriptionSet = true;
      this.processQueuedCandidates();
    }
  }

  /**
   * Adds received remote ICE candidate
   */
  async addRemoteCandidate(candidateInit) {
    if (!candidateInit) return;
    const candidate = new RTCIceCandidate(candidateInit);

    if (this.isRemoteDescriptionSet && this.peerConnection) {
      try {
        await this.peerConnection.addIceCandidate(candidate);
      } catch (err) {
        console.warn('[WebRTC] Error adding ICE candidate:', err);
      }
    } else {
      this.iceCandidatesQueue.push(candidate);
    }
  }

  /**
   * Flushes queued candidates once remote description is set
   */
  async processQueuedCandidates() {
    while (this.iceCandidatesQueue.length > 0 && this.peerConnection) {
      const candidate = this.iceCandidatesQueue.shift();
      try {
        await this.peerConnection.addIceCandidate(candidate);
      } catch (err) {
        console.warn('[WebRTC] Error adding queued ICE candidate:', err);
      }
    }
  }

  /**
   * Starts listening for signaling messages (via Firebase or polling)
   */
  startListening(callback) {
    if (this.useFirebase && this.firebaseDb) {
      const sessionRef = this.firebaseDb.ref(`sessions/${this.sessionId}`);

      sessionRef.on('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
          if (callback) callback(val);
          this.handleSignalingUpdate(val);
        }
      });
      return;
    }

    // Polling fallback
    if (this.pollInterval) clearInterval(this.pollInterval);

    this.pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/signaling/poll?sessionId=${encodeURIComponent(this.sessionId)}&role=${this.role}`);
        if (res.ok) {
          const data = await res.json();
          if (callback) callback(data);
          this.handleSignalingUpdate(data);
        }
      } catch (err) {
        // Silent poll error
      }
    }, 1000);
  }

  /**
   * Internal signaling handler
   */
  async handleSignalingUpdate(data) {
    if (!data) return;

    if (this.role === 'admin') {
      // Admin looking for visitor's offer
      if (data.offer && this.peerConnection && this.peerConnection.signalingState === 'stable' && !this.isRemoteDescriptionSet) {
        await this.createAndSendAnswer(data.offer);
      }
    } else if (this.role === 'visitor') {
      // Visitor looking for admin's answer
      if (data.answer && this.peerConnection && this.peerConnection.signalingState === 'have-local-offer') {
        await this.handleRemoteAnswer(data.answer);
      }
    }

    // Handle candidates
    if (data.candidates) {
      const candidateList = Array.isArray(data.candidates)
        ? data.candidates
        : Object.values(data.candidates);

      for (const cand of candidateList) {
        await this.addRemoteCandidate(cand);
      }
    }
  }

  /**
   * Closes connection and cleans up
   */
  closePeerConnection() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.peerConnection) {
      try {
        this.peerConnection.ontrack = null;
        this.peerConnection.onicecandidate = null;
        this.peerConnection.onconnectionstatechange = null;
        this.peerConnection.close();
      } catch (err) {}
      this.peerConnection = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      this.localStream = null;
    }

    this.isRemoteDescriptionSet = false;
    this.iceCandidatesQueue = [];
  }
}
