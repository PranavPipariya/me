// The microwave bits: an honest receipt, instant clicks, and a button that beeps.

(function () {
    // ── the receipt: what this page actually cost, measured, not claimed ───
    const receipt = document.querySelector('[data-receipt]');
    if (receipt && 'performance' in window) {
        const write = () => {
            const nav = performance.getEntriesByType('navigation')[0];
            const bytes = [nav, ...performance.getEntriesByType('resource')]
                .reduce((sum, e) => sum + (e ? e.encodedBodySize || 0 : 0), 0);
            const kb = Math.max(1, Math.round(bytes / 1024));
            const ms = nav ? Math.round(nav.domContentLoadedEventEnd) : 0;
            const cookies = document.cookie ? document.cookie.split(';').length : 0;
            receipt.textContent = `${kb} KB, 0 trackers, ${cookies} cookies, rendered in ${ms} ms, `;
        };
        if (document.readyState === 'complete') write();
        else window.addEventListener('load', write);
    }

    // ── clicks that are already done: fetch a page as soon as you point at it ──
    if (HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
        const rules = document.createElement('script');
        rules.type = 'speculationrules';
        rules.textContent = JSON.stringify({
            prefetch: [{ where: { href_matches: '/*' }, eagerness: 'moderate' }],
        });
        document.head.appendChild(rules);
    } else {
        const done = new Set();
        const warm = (e) => {
            const a = e.target.closest && e.target.closest('a[href]');
            if (!a || a.origin !== location.origin || done.has(a.href)) return;
            done.add(a.href);
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = a.href;
            document.head.appendChild(link);
        };
        document.addEventListener('pointerover', warm);
        document.addEventListener('touchstart', warm, { passive: true });
    }

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
