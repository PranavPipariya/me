// "You press a button, it beeps, the plate spins." It does.

(function () {
    // ── "You press a button, it beeps, the plate spins." ────────────────────
    let audio;
    function beep() {
        try {
            audio = audio || new (window.AudioContext || window.webkitAudioContext)();
            const t = audio.currentTime;
            const osc = audio.createOscillator();
            const gain = audio.createGain();
            osc.type = 'square';
            osc.frequency.value = 1150;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.04, t + 0.01);
            gain.gain.setValueAtTime(0.04, t + 0.14);
            gain.gain.linearRampToValueAtTime(0, t + 0.16);
            osc.connect(gain).connect(audio.destination);
            osc.start(t);
            osc.stop(t + 0.17);
        } catch {
            // No audio: the plate still spins.
        }
    }

    function spin() {
        const divider = document.querySelector('.divider');
        if (!divider) return;
        let plate = divider.querySelector('.plate');
        if (!plate) {
            plate = document.createElement('span');
            plate.className = 'plate';
            plate.setAttribute('aria-hidden', 'true');
            divider.appendChild(plate);
        }
        plate.classList.remove('go');
        void plate.offsetWidth; // restart the animation
        plate.classList.add('go');
    }

    document.querySelectorAll('.micro-btn').forEach((b) =>
        b.addEventListener('click', () => { beep(); spin(); }));

})();
