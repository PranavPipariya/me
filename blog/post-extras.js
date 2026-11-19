// Post enhancements: syntax highlighting, copy buttons, and live demos.
// Call enhancePost(articleElement) after the Markdown has been rendered.

(function () {
    // ── code blocks ─────────────────────────────────────────────────────────
    function enhanceCode(root) {
        root.querySelectorAll('pre > code').forEach((code) => {
            const lang = (code.className.match(/language-(\w+)/) || [])[1];
            if (lang && window.hljs && hljs.getLanguage(lang)) hljs.highlightElement(code);

            const pre = code.parentElement;
            pre.classList.add('code-block');

            const btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.type = 'button';
            btn.textContent = 'copy';
            btn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(code.innerText);
                    btn.textContent = 'copied';
                } catch {
                    btn.textContent = 'press ⌘C';
                }
                setTimeout(() => (btn.textContent = 'copy'), 1400);
            });
            pre.appendChild(btn);
        });
    }

    // ── three ways to sync a text: indices, numbers, neighbours ─────────────
    const cmpID = (a, b) => a[0] - b[0] || a[1] - b[1];
    const sameID = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

    // The original bug: send "insert c at i" and replay it blindly.
    class IndexDoc {
        constructor(agent, text = '') { this.agent = agent; this.s = text; }
        clone(agent) { return new IndexDoc(agent, this.s); }
        insert(pos, ch) { this.s = this.s.slice(0, pos) + ch + this.s.slice(pos); return { t: 'ins', pos, ch }; }
        remove(pos) { this.s = this.s.slice(0, pos) + this.s.slice(pos + 1); return { t: 'del', pos }; }
        apply(op) {
            const pos = Math.min(op.pos, this.s.length);
            if (op.t === 'ins') this.s = this.s.slice(0, pos) + op.ch + this.s.slice(pos);
            else this.s = this.s.slice(0, pos) + this.s.slice(pos + 1);
        }
        text() { return this.s; }
    }

    // Attempt 2: a number halfway between the neighbours, ties broken by replica.
    class FracDoc {
        constructor(agent) { this.agent = agent; this.seq = 0; this.items = []; }
        clone(agent) { const d = new FracDoc(agent); d.items = this.items.map((c) => ({ ...c })); return d; }
        insert(i, ch) {
            const lo = i > 0 ? this.items[i - 1].pos : 0;
            const hi = i < this.items.length ? this.items[i].pos : 1;
            const c = { pos: (lo + hi) / 2, rep: this.agent, uid: `${this.agent}:${++this.seq}`, ch };
            this.place(c);
            return { t: 'ins', c };
        }
        remove(i) { const [c] = this.items.splice(i, 1); return { t: 'del', uid: c.uid }; }
        place(c) {
            let i = 0;
            while (i < this.items.length && (this.items[i].pos - c.pos || this.items[i].rep - c.rep) < 0) i++;
            this.items.splice(i, 0, { ...c });
        }
        apply(op) {
            if (op.t === 'ins') this.place(op.c);
            else this.items = this.items.filter((c) => c.uid !== op.uid);
        }
        text() { return this.items.map((c) => c.ch).join(''); }
    }

    // Attempt 3: remember the neighbours (YjsMod / FugueMax), a port of list.go.
    class List {
        constructor(agent) { this.agent = agent; this.seq = 0; this.items = []; }
        clone(agent) { const l = new List(agent); l.items = this.items.map((it) => ({ ...it })); return l; }
        cursor(pos) { let i = 0; for (; pos > 0; i++) if (!this.items[i].del) pos--; return i; }
        find(id) { return id ? this.items.findIndex((it) => sameID(it.id, id)) : -1; }
        insert(pos, ch) {
            const i = this.cursor(pos);
            const op = {
                t: 'ins', id: [this.agent, ++this.seq], ch,
                ol: i > 0 ? this.items[i - 1].id : null,
                or: i < this.items.length ? this.items[i].id : null,
            };
            this.integrate(op, i);
            return op;
        }
        remove(pos) {
            let i = this.cursor(pos);
            while (this.items[i].del) i++;
            this.items[i].del = true;
            return { t: 'del', target: this.items[i].id };
        }
        apply(op) {
            if (op.t === 'ins') this.integrate(op, this.find(op.ol) + 1);
            else this.items[this.find(op.target)].del = true;
        }
        integrate(op, dest) {
            const left = dest - 1;
            const right = op.or ? this.find(op.or) : this.items.length;
            let scanning = false;
            for (let i = dest; ; i++) {
                if (!scanning) dest = i;
                if (i === right) break;
                const o = this.items[i];
                const oleft = this.find(o.ol);
                const oright = o.or ? this.find(o.or) : this.items.length;
                if (oleft < left || (oleft === left && oright === right && cmpID(op.id, o.id) < 0)) break;
                if (oleft === left) scanning = oright < right;
            }
            this.items.splice(dest, 0, { id: op.id, ol: op.ol, or: op.or, ch: op.ch, del: false });
        }
        text() { return this.items.filter((it) => !it.del).map((it) => it.ch).join(''); }
    }

    const MODES = {
        index: { label: 'indices', make: () => new IndexDoc(0), note: 'The original bug: each edit is sent as “insert c at i” and replayed as-is.' },
        frac: { label: 'numbers', make: () => new FracDoc(0), note: 'Attempt 2: each character gets a number halfway between its neighbours.' },
        fugue: { label: 'neighbours', make: () => new List(0), note: 'Attempt 3: each character remembers what it was typed next to (FugueMax).' },
    };

    const PRESETS = {
        helo: {
            label: '“Helo”', start: 'Helo',
            play: [['A', 'ins', 3, 'l'], ['B', 'ins', 4, '!']],
            hint: 'Alice inserts “l” at 3 while Bob adds “!” at 4.',
        },
        empty: {
            label: 'empty', start: '',
            play: [...'Hello'].map((c, i) => ['A', 'ins', i, c]).concat([...'Hi'].map((c, i) => ['B', 'ins', i, c])),
            hint: 'Alice types “Hello” while Bob types “Hi”.',
        },
    };

    function seeded(mode, text) {
        const base = MODES[mode].make();
        [...text].forEach((c, i) => base.insert(i, c));
        return base;
    }

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function mountDemo(host) {
        const modes = (host.dataset.modes || 'index,frac,fugue').split(',');
        let mode = host.dataset.mode || modes[0];
        let preset = host.dataset.preset || 'helo';
        let A, B, outA, outB, timer;

        host.innerHTML = '';

        // Every line is "label  content", like the rest of the page.
        const line = (label) => {
            const row = el('div', 'demo-line');
            row.appendChild(el('span', 'demo-label', label));
            host.appendChild(row);
            return row;
        };
        const link = (row, text, onclick) => {
            const b = el('button', 'demo-link', text);
            b.type = 'button';
            b.onclick = onclick;
            row.appendChild(b);
            return b;
        };

        const modeBtns = [];
        if (modes.length > 1) {
            const row = line('method');
            modes.forEach((m) => modeBtns.push([m, link(row, MODES[m].label, () => { mode = m; reset(); })]));
        }
        const presetRow = line('start');
        const presetBtns = Object.entries(PRESETS).map(([k, p]) =>
            [k, link(presetRow, p.label, () => { preset = k; reset(); })]);

        const sides = ['A', 'B'].map((who) => {
            const row = line(who === 'A' ? 'alice' : 'bob');
            const input = el('input', 'demo-input');
            input.spellcheck = false;
            input.autocomplete = 'off';
            input.setAttribute('aria-label', who === 'A' ? 'Alice\'s copy' : 'Bob\'s copy');
            const pending = el('span', 'demo-pending');
            row.append(input, pending);
            return { who, input, pending, prev: '' };
        });

        const actions = line('');
        link(actions, 'sync', () => sync());
        link(actions, 'play the example', () => play());
        link(actions, 'reset', () => reset());
        const status = el('div', 'demo-status');
        host.appendChild(status);

        const doc = (who) => (who === 'A' ? A : B);
        const out = (who) => (who === 'A' ? outA : outB);

        function render() {
            sides.forEach((s) => {
                s.input.value = s.prev = doc(s.who).text();
                const n = out(s.who).length;
                s.pending.textContent = n ? `${n} unsent` : '';
            });
        }

        function reset() {
            clearTimeout(timer);
            const base = seeded(mode, PRESETS[preset].start);
            A = base.clone(1);
            B = base.clone(2);
            outA = [];
            outB = [];
            modeBtns.forEach(([m, b]) => b.classList.toggle('on', m === mode));
            presetBtns.forEach(([k, b]) => b.classList.toggle('on', k === preset));
            status.textContent = '';
            status.className = 'demo-status';
            render();
        }

        // Turn whatever the user did to an input into single-character edits.
        function onInput(s) {
            const before = s.prev, after = s.input.value;
            let p = 0;
            while (p < before.length && p < after.length && before[p] === after[p]) p++;
            let q = 0;
            while (q < before.length - p && q < after.length - p &&
                   before[before.length - 1 - q] === after[after.length - 1 - q]) q++;
            const d = doc(s.who), o = out(s.who);
            for (let k = 0; k < before.length - p - q; k++) o.push(d.remove(p));
            [...after.slice(p, after.length - q)].forEach((c, k) => o.push(d.insert(p + k, c)));
            const caret = s.input.selectionStart;
            render();
            s.input.setSelectionRange(caret, caret);
            status.textContent = '';
        }
        sides.forEach((s) => s.input.addEventListener('input', () => onInput(s)));

        function sync() {
            outB.forEach((op) => A.apply(op));
            outA.forEach((op) => B.apply(op));
            outA = [];
            outB = [];
            render();
            const a = A.text(), b = B.text();
            if (a === b) {
                status.textContent = `→ both read “${a}”`;
                status.className = 'demo-status ok';
            } else {
                status.textContent = `→ out of sync: alice has “${a}”, bob has “${b}”`;
                status.className = 'demo-status bad';
            }
        }

        function play() {
            reset();
            const steps = PRESETS[preset].play.slice();
            const tick = () => {
                if (!steps.length) { timer = setTimeout(sync, 450); return; }
                const [who, , pos, ch] = steps.shift();
                out(who).push(doc(who).insert(pos, ch));
                render();
                timer = setTimeout(tick, 160);
            };
            tick();
        }

        reset();
    }


    // ── shared bits for the smaller demos ──────────────────────────────────
    function mkLine(host, label) {
        const row = el('div', 'demo-line');
        row.appendChild(el('span', 'demo-label', label));
        host.appendChild(row);
        return row;
    }
    function mkLink(row, text, onclick) {
        const b = el('button', 'demo-link', text);
        b.type = 'button';
        b.onclick = onclick;
        row.appendChild(b);
        return b;
    }
    function mkStatus(host) {
        const s = el('div', 'demo-status');
        host.appendChild(s);
        return (text, bad) => { s.textContent = text; s.className = 'demo-status' + (bad ? ' bad' : ''); };
    }
    // What changed between two strings, as single-character edits.
    function diffOps(before, after) {
        let p = 0;
        while (p < before.length && p < after.length && before[p] === after[p]) p++;
        let q = 0;
        while (q < before.length - p && q < after.length - p &&
               before[before.length - 1 - q] === after[after.length - 1 - q]) q++;
        const ops = [];
        for (let k = 0; k < before.length - p - q; k++) ops.push({ pos: p, del: true });
        [...after.slice(p, after.length - q)].forEach((ch, k) => ops.push({ pos: p + k, ch }));
        return ops;
    }
    const applyOp = (s, op) => op.del ? s.slice(0, op.pos) + s.slice(op.pos + 1)
                                      : s.slice(0, op.pos) + op.ch + s.slice(op.pos);

    // ── part 1: three Raft nodes, one of them on a plane ────────────────────
    // A model of the scenario, not a Raft implementation: a write commits once
    // a majority (2 of 3) has it, and an isolated node can't reach a majority.
    function mountRaft(host) {
        host.innerHTML = '';
        let nodes, leader, term, plane, timer;

        const rows = [0, 1, 2].map((i) => {
            const row = mkLine(host, `node ${i + 1}`);
            const input = el('input', 'demo-input');
            input.spellcheck = false;
            input.autocomplete = 'off';
            input.setAttribute('aria-label', `Node ${i + 1}`);
            const note = el('span', 'demo-pending');
            row.append(input, note);
            input.addEventListener('input', () => type(i, input.value));
            input.addEventListener('focus', () => {
                if (!nodes[i].leads) status(`→ node ${i + 1} is a follower. every write goes through the leader, node ${leader + 1}.`);
            });
            return { input, note };
        });
        const actions = mkLine(host, '');
        const planeBtn = mkLink(actions, 'put the leader on a plane', () => (plane < 0 ? takeOff() : land()));
        mkLink(actions, 'play the example', () => play());
        mkLink(actions, 'reset', () => reset());
        const status = mkStatus(host);

        function render() {
            nodes.forEach((n, i) => {
                const r = rows[i];
                r.input.value = n.text;
                r.input.readOnly = !n.leads;
                r.input.classList.toggle('demo-readonly', !n.leads);
                let note = n.leads ? `leader · term ${n.term}` : 'follower';
                if (i === plane) note = `on a plane · term ${n.term}` + (n.pending.length ? ` · ${n.pending.length} waiting` : '');
                r.note.textContent = note;
                r.note.classList.toggle('quiet', i !== plane);
            });
            planeBtn.textContent = plane < 0 ? 'put the leader on a plane' : 'land';
        }

        function type(i, value) {
            const n = nodes[i];
            if (!n.leads) { render(); return; }
            const ops = diffOps(n.text, value);
            if (i === plane) {
                // Accepted into the log, but there's no majority to commit it.
                n.pending.push(...ops);
                status('→ no majority, so nothing commits. node ' + (i + 1) + ' still shows “' + n.text + '”', true);
            } else {
                nodes.forEach((m, j) => { if (j !== plane) m.text = ops.reduce(applyOp, m.text); });
                status(`→ committed on ${plane < 0 ? 'all three nodes' : 'the two nodes on the ground'}`);
            }
            const caret = rows[i].input.selectionStart;
            render();
            if (i !== plane) rows[i].input.setSelectionRange(caret, caret);
        }

        function takeOff() {
            plane = leader;
            term++;
            leader = [0, 1, 2].find((i) => i !== plane);
            nodes[leader].leads = true;
            nodes[leader].term = term;
            nodes.forEach((n, i) => { if (i !== plane) n.term = term; });
            render();
            status(`→ the ground stops hearing from node ${plane + 1} and elects node ${leader + 1} (term ${term}). node ${plane + 1} still thinks it's in charge.`);
        }

        function land() {
            const n = nodes[plane];
            const lost = n.pending.filter((op) => !op.del).map((op) => op.ch).join('');
            n.leads = false;
            n.term = term;
            n.pending = [];
            n.text = nodes[leader].text;
            const who = plane + 1;
            plane = -1;
            render();
            if (lost) status(`→ node ${who} sees term ${term} and steps down. its uncommitted “${lost}” is gone. every node reads “${n.text}”.`, true);
            else status(`→ node ${who} sees term ${term} and steps down. every node reads “${n.text}”.`);
        }

        function reset() {
            clearTimeout(timer);
            nodes = [0, 1, 2].map((i) => ({ text: 'H', leads: i === 0, term: 1, pending: [] }));
            leader = 0;
            term = 1;
            plane = -1;
            render();
            status('');
        }

        function play() {
            reset();
            const steps = [
                () => takeOff(),
                () => type(0, 'Hi'),
                () => type(leader, 'Ho'),
                () => land(),
            ];
            const tick = () => { steps.shift()(); if (steps.length) timer = setTimeout(tick, 1600); };
            timer = setTimeout(tick, 300);
        }

        reset();
    }

    // ── part 2: two replicas of a shopping list ─────────────────────────────
    const SETS = {
        union: {
            label: 'union',
            make: () => ({ has: false }),
            add: (s) => { s.has = true; },
            remove: (s) => { s.has = false; },
            has: (s) => s.has,
            merge: (x, y) => ({ has: x.has || y.has }),
            show: (s) => (s.has ? '{ milk }' : '{ }'),
        },
        tomb: {
            label: 'tombstones',
            make: () => ({ added: false, removed: false }),
            add: (s) => { s.added = true; },
            remove: (s) => { if (s.added) s.removed = true; },
            has: (s) => s.added && !s.removed,
            merge: (x, y) => ({ added: x.added || y.added, removed: x.removed || y.removed }),
            show: (s) => (s.added && !s.removed ? '{ milk }' : s.removed ? '{ } † milk' : '{ }'),
        },
        or: {
            label: 'or-set',
            make: (id) => ({ id, clock: [0, 0], dots: [] }),
            add: (s) => { s.clock[s.id]++; s.dots = [[s.id, s.clock[s.id]]]; },
            remove: (s) => { s.dots = []; },
            has: (s) => s.dots.length > 0,
            merge: (s, o) => {
                const has = (list, d) => list.some((e) => e[0] === d[0] && e[1] === d[1]);
                const keep = [];
                for (const d of s.dots) if (has(o.dots, d) || d[1] > o.clock[d[0]]) keep.push(d);
                for (const d of o.dots) if (!has(s.dots, d) && d[1] > s.clock[d[0]]) keep.push(d);
                return { clock: [0, 1].map((r) => Math.max(s.clock[r], o.clock[r])), dots: keep };
            },
            show: (s) => (s.dots.length ? `{ milk (${s.dots.map((d) => 'ab'[d[0]] + d[1]).join(', ')}) }` : '{ }'),
            clock: (s) => `seen a${s.clock[0]} b${s.clock[1]}`,
        },
    };

    function mountSet(host) {
        host.innerHTML = '';
        let method = host.dataset.mode || 'or';
        let reps, timer;

        const methodRow = mkLine(host, 'merge');
        const methodBtns = Object.entries(SETS).map(([k, m]) => [k, mkLink(methodRow, m.label, () => { method = k; reset(); })]);

        const rows = [0, 1].map((id) => {
            const row = mkLine(host, 'ab'[id]);
            const show = el('span', 'demo-set');
            const txt = el('span');
            const clock = el('span', 'demo-clock');
            show.append(txt, clock);
            row.appendChild(show);
            mkLink(row, 'add milk', () => act(id, 'add'));
            mkLink(row, 'remove', () => act(id, 'remove'));
            return { txt, clock };
        });
        const actions = mkLine(host, '');
        mkLink(actions, 'sync', () => sync());
        mkLink(actions, 'play the example', () => play());
        mkLink(actions, 'reset', () => reset());
        const status = mkStatus(host);

        const M = () => SETS[method];
        function render() {
            rows.forEach((r, id) => {
                r.txt.textContent = M().show(reps[id]);
                r.clock.textContent = M().clock ? '  ' + M().clock(reps[id]) : '';
            });
        }

        function act(id, what) {
            const s = reps[id];
            const before = M().has(s);
            M()[what](s);
            render();
            const name = 'ab'[id];
            if (what === 'add' && !M().has(s)) status(`→ ${name} can't add milk: there's a tombstone for it`, true);
            else if (what === 'remove' && !before) status(`→ ${name} has no milk to remove`);
            else status(`→ ${name} ${what === 'add' ? 'adds' : 'removes'} milk`);
        }

        function sync() {
            const m = M().merge(reps[0], reps[1]);
            reps = [0, 1].map((id) => ({ ...JSON.parse(JSON.stringify(m)), id }));
            render();
            status(`→ both: ${M().show(reps[0])}`);
            return M().has(reps[0]);
        }

        function reset() {
            clearTimeout(timer);
            reps = [0, 1].map((id) => M().make(id));
            methodBtns.forEach(([k, b]) => b.classList.toggle('on', k === method));
            render();
            status('');
        }

        // Two tests. A plain remove: does it stick? Then a remove and an add
        // at the same time: which one wins?
        function play() {
            reset();
            let removeStuck, readded, addWon;
            const steps = [
                () => act(0, 'add'),
                () => sync(),
                () => act(0, 'remove'),
                () => { removeStuck = !sync(); },
                () => { act(0, 'add'); readded = M().has(reps[0]); },
                () => sync(),
                () => { act(0, 'remove'); act(1, 'add'); status('→ at the same time: a removes milk, b adds it'); },
                () => {
                    addWon = sync();
                    if (!removeStuck) status('→ a plain remove never stuck: syncing brought the milk back', true);
                    else if (!readded) status('→ removes stick, but milk can never be added back', true);
                    else if (addWon) status('→ removes stick, and the concurrent add wins');
                    else status('→ the concurrent add was lost', true);
                },
            ];
            const tick = () => { steps.shift()(); if (steps.length) timer = setTimeout(tick, 1000); };
            timer = setTimeout(tick, 300);
        }

        reset();
    }

    window.enhancePost = function (root) {
        enhanceCode(root);
        root.querySelectorAll('.crdt-demo').forEach(mountDemo);
        root.querySelectorAll('.raft-demo').forEach(mountRaft);
        root.querySelectorAll('.set-demo').forEach(mountSet);
    };
})();
