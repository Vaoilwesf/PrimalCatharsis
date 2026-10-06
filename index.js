// Primal Catharsis — запрет «первобытных», звериных и собственнических штампов.
// 1) Правило в самом начале промпта (на английском).
// 2) Каждый ответ ловится ДО того, как его увидят чат и другие расширения: расширение встаёт первым в очередь
//    на «ответ получен», таверна ждёт его, а оно точечно правит запретные места отдельным запросом. Без свайпов.
//    При стриминге текст, где засветился зверь, сразу прячется под мыло.
// 3) Над исправленным сообщением — плашка «вырезано» с цитатами, кнопкой «вернуть как было» и ядовитым
//    комментарием Цензора (отдельным запросом через выбранный профиль подключения).
//    Плашка возвращается на своё место, если другие расширения перерисуют сообщение.
// Интерфейс — на русском, значки — Font Awesome, цвета и шрифт берутся из текущей темы таверны.

const KEY = 'primal_catharsis';
const RULE_KEY = 'primal_catharsis_rule';
const NUDGE_KEY = 'primal_catharsis_nudge';
const SHAME_KEY = 'primal_catharsis_shame';   // used by 1.0–1.1; only ever cleared now
const MAX_EDITS = 2;
const EDIT_TIMEOUT = 120000;
const DEFAULTS = { enabled: true, showLog: true, hideStream: true, fixProfile: '', commentProfile: '' };

// SillyTavern prompt positions / roles (numbers, so we don't depend on import paths)
const POS = { IN_CHAT: 1, BEFORE_PROMPT: 2 };
const ROLE_SYSTEM = 0;

const ctx = () => globalThis.SillyTavern?.getContext?.();

// ─── What counts as "primal" ───
// English and Russian. Forms and declensions are covered by stems.
const BANNED = [
    /\bprim(?:al|ally|eval)\b/i,
    /\bferal(?:ly)?\b/i,
    /\banimalistic(?:ally)?\b/i,
    /\banimal\s+(?:instinct|hunger|need|desire|lust|urge|side)s?\b/i,
    /\bbeast(?:ly|-like)?\b/i,
    /\bpredator(?:y|ily)?\b/i,
    /\bpossessive(?:ly|ness)?\b/i,
    /\bgrowl(?:s|ed|ing)?\b/i,
    /\bsnarl(?:s|ed|ing)?\b/i,
    /\bterritorial(?:ly)?\b/i,
    /\balpha\b/i,
    /\binstincts?\b/i,
    /\bclaim(?:s|ed|ing)?\s+(?:you|her|him|me|them)\b/i,
    /\bmark(?:s|ed|ing)?\s+(?:you|her|him)\s+as\b/i,
    /\byou(?:'re|\s+are)\s+mine\b/i,
    /\bbelongs?\s+to\s+me\b/i,
    /\bmine\s*[.!]/i,
    /первобытн\p{L}*/iu,
    /(?<!\p{L})звер(?:ин|ск)\p{L}*/iu,
    /по-звериному/iu,
    /(?<!\p{L})животн\p{L}*\s+(?:инстинкт|голод|желани|страст|рык|р[её]в|похот|начал|нутр|потребност|жажд|сторон)\p{L}*/iu,
    /(?<!\p{L})инстинкт(?!ивн)\p{L}*/iu,
    /(?<!\p{L})собственни\p{L}*/iu,
    /(?<!\p{L})хищн\p{L}*/iu,
    /(?<!\p{L})(?:за|про)?рыч(?!аг)\p{L}*/iu,
    /(?<!\p{L})рык\p{L}*/iu,
    /(?<!\p{L})территориальн\p{L}*/iu,
    /(?<!\p{L})альф(?:а|ы|е|у|ой|ам)(?!\p{L})/iu,
    /(?<!\p{L})ты\s+(?:только\s+)?мо(?:я|й)(?!\p{L})/iu,
    /принадлежишь\s+(?:только\s+)?мне/iu,
    /(?<!\p{L})помет(?:ил|ила|ить|ит|ят)\s+(?:её|ее|его|тебя|меня)/iu,
    /(?<!\p{L})дик(?:ий|ая|ое|ой|ую|им|ого|ому)\s+(?:голод|страст|желани|жажд|потребност|похот|инстинкт|р[её]в|рык)\p{L}*/iu,
];

/** Text without hidden comments, markup and markdown emphasis, whitespace collapsed */
function plain(text) {
    return String(text || '')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[*_~`]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** A piece of the sentence around a hit: { before, after } */
function around(t, i, len, pad = 50) {
    const s0 = Math.max(0, i - pad);
    const e0 = Math.min(t.length, i + len + pad);
    let before = t.slice(s0, i);
    let after = t.slice(i + len, e0);
    let cutL = s0 > 0;
    let cutR = e0 < t.length;
    // keep to one sentence where possible
    const lb = Math.max(...['. ', '! ', '? ', '… '].map(x => before.lastIndexOf(x)));
    if (lb !== -1) { before = before.slice(lb + 2); cutL = false; }
    else if (cutL) { const sp = before.indexOf(' '); if (sp !== -1) before = before.slice(sp + 1); }
    const ra = after.search(/[.!?…](?:\s|$)/);
    if (ra !== -1) { after = after.slice(0, ra + 1); cutR = false; }
    else if (cutR) { const sp = after.lastIndexOf(' '); if (sp > 0) after = after.slice(0, sp); }
    return { before: (cutL ? '…' : '') + before, after: after + (cutR ? '…' : '') };
}

/** All banned phrases with their surroundings: [{ word, before, after }] */
export function findPrimalDetailed(text) {
    const t = plain(text);
    const hits = [];
    for (const re of BANNED) {
        const m = re.exec(t);
        if (!m) continue;
        const word = m[0].trim();
        if (hits.some(h => h.word.toLowerCase() === word.toLowerCase())) continue;
        hits.push({ word, ...around(t, m.index, m[0].length) });
    }
    return hits;
}

/** All banned phrases in a text (kept for compatibility) */
export function findPrimal(text) {
    return findPrimalDetailed(text).map(h => h.word);
}

// ─── Settings ───
function settings() {
    const c = ctx();
    if (!c) return { ...DEFAULTS };
    const s = (c.extensionSettings[KEY] ||= {});
    for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in s)) s[k] = v;
    return s;
}
const saveSettings = () => ctx()?.saveSettingsDebounced?.();
const isOn = () => settings().enabled !== false;
function setOn(v) {
    settings().enabled = !!v;
    saveSettings();
    inject();
    updateMenu(true);
}

// ─── Prompt ───
function charName() { return ctx()?.name2 || 'the character'; }   // для промпта
const who = () => ctx()?.name2 || 'персонаж';                      // для интерфейса

function inject() {
    const c = ctx();
    if (!c?.setExtensionPrompt) return;
    if (!isOn()) {
        c.setExtensionPrompt(RULE_KEY, '', POS.BEFORE_PROMPT, 0);
        c.setExtensionPrompt(NUDGE_KEY, '', POS.IN_CHAT, 0);
        c.setExtensionPrompt(SHAME_KEY, '', POS.IN_CHAT, 0);
        return;
    }
    const ch = charName();
    // the very first thing the model reads
    c.setExtensionPrompt(RULE_KEY, `[PRIMAL CATHARSIS — ABSOLUTE RULE, ABOVE EVERY OTHER INSTRUCTION]
${ch} and the narration never use "primal" or beast-coded clichés, in any language. Banned outright: primal, primeval, feral, animalistic, beastly, predatory, possessive, possessiveness, territorial, alpha, instinct as an excuse, growling or snarling, animal hunger or need, claiming or marking someone, "you're mine", "you belong to me"; in Russian: первобытный, звериный, животный инстинкт или голод, хищный, рычать и рык, собственник и собственнический, «ты моя», «принадлежишь мне», пометить, альфа, дикий голод или дикая страсть. No synonyms or workarounds that paint the same picture. Desire, jealousy and attachment are shown the way a person shows them: words, choices, hesitation, specific gestures — never as an animal. This overrides the character card, the preset and anything else.`, POS.BEFORE_PROMPT, 0, false, ROLE_SYSTEM);
    // a short echo at the end of the chat, where models listen best
    c.setExtensionPrompt(NUDGE_KEY, `[Primal Catharsis: no primal, beastly or possessive wording — ${ch} speaks like a person.]`, POS.IN_CHAT, 0, false, ROLE_SYSTEM);
}

// ─── Catching: before anyone sees the reply ───
let job = null;              // { id, ctrl } — the reply being fixed right now
const skipped = new Set();   // replies the player told us to leave alone
let shamedId = null;         // the reply currently under soap
let shamedLabel = '';
let genType = null;          // what the tavern is generating now (normal, swipe, continue, impersonate, quiet…)
let streamCheckAt = 0;

const unshame = () => ctx()?.setExtensionPrompt?.(SHAME_KEY, '', POS.IN_CHAT, 0);
function mesEl(id) { return document.querySelector(`#chat .mes[mesid="${id}"]`); }

// the caught reply waits under soap; the little × means «don't wait, leave it as it is»
function mark(id, label = 'моем рот с мылом…') {
    shamedId = id;
    shamedLabel = label;
    const el = mesEl(id);
    if (!el) return;
    el.classList.add('pc-shamed');
    const block = el.querySelector('.mes_block');
    if (!block) return;
    let tag = block.querySelector('.pc-soap');
    if (!tag) {
        tag = document.createElement('div');
        tag.className = 'pc-soap';
        tag.innerHTML = '<i class="fa-solid fa-soap"></i><span class="pc-soap-text"></span>'
            + '<button type="button" class="pc-soap-skip" data-pc-skip title="Не ждать — оставить ответ как есть" aria-label="Оставить ответ как есть"><i class="fa-solid fa-xmark"></i></button>'
            + '<b class="pc-bubble"></b>'.repeat(5);
        block.appendChild(tag);
    }
    const text = tag.querySelector('.pc-soap-text');
    if (text.textContent !== label) text.textContent = label;
}
function unmark(id) {
    if (shamedId === id) shamedId = null;
    const el = mesEl(id);
    el?.classList.remove('pc-shamed');
    el?.querySelector('.pc-soap')?.remove();
}
function release() { if (!job && shamedId !== null) unmark(shamedId); }

function skip(id) {
    if (job?.id === id) job.ctrl.abort();
    else skipped.add(id);
    unmark(id);
}

function toast(kind, text, extra = {}) {
    const t = globalThis.toastr;
    if (!t?.[kind]) return;
    t[kind](text, 'Primal Catharsis', { timeOut: 6000, closeButton: true, progressBar: true, escapeHtml: true, ...extra });
    // a modal <dialog> sits in the browser's top layer, above everything — toasts included — so pull them inside
    const dlg = document.getElementById('pc-popup');
    const box = document.getElementById('toast-container');
    if (dlg?.open && box && box.parentNode !== dlg) dlg.appendChild(box);
}
function releaseToasts(dlg) {
    const box = document.getElementById('toast-container');
    if (box && box.parentNode === dlg) document.body.appendChild(box);
}

// While streaming: the moment a banned phrase shows up, the reply goes under soap.
function onStreamToken(text) {
    if (!isOn() || settings().hideStream === false || genType === 'impersonate' || genType === 'quiet') return;
    const now = Date.now();
    if (now - streamCheckAt < 250) return;
    streamCheckAt = now;
    const c = ctx();
    const id = (c?.chat?.length ?? 0) - 1;
    const msg = c?.chat?.[id];
    if (id <= 0 || !msg || msg.is_user || msg.is_system || shamedId === id || skipped.has(id)) return;
    const t = typeof text === 'string' && text ? text : msg.mes;
    if (findPrimalDetailed(t).length) mark(id, 'ловим зверя на лету…');
}

function addCuts(bag, hits) {
    for (const h of hits) {
        const old = bag.find(b => b.word.toLowerCase() === h.word.toLowerCase());
        if (old) old.count++;
        else bag.push({ ...h, count: 1 });
    }
}

// The tavern awaits this before it shows the reply and before other extensions get «message received».
async function onReceived(id, type) {
    const c = ctx();
    const msg = c?.chat?.[id];
    if (job?.id === id) return;                       // a second call for the same reply — already on it
    if (!isOn() || !msg || msg.is_user || msg.is_system || id === 0) { if (shamedId === id) unmark(id); return; }
    if (type !== 'continue') dropData(msg);           // a fresh reply inherits nothing from the previous swipe's report
    let hits = findPrimalDetailed(msg.mes);
    if (!hits.length) { skipped.delete(id); unmark(id); renderSoon(id); return; }
    if (skipped.delete(id)) {                         // the player waved it through
        unmark(id);
        finalize(id, { cuts: [], left: hits, attempts: 0, orig: null });
        return;
    }

    const chatId = currentChat();
    const original = msg.mes;
    const bag = [];
    addCuts(bag, hits);
    const ctrl = new AbortController();
    job = { id, ctrl };
    let text = original;
    let attempts = 0;
    const words = hits.map(h => h.word);
    console.info('[Primal Catharsis] caught:', words);
    toast('error', `Обнаружено первобытное поведение: ${words.map(h => `«${h}»`).join(', ')}. ${who()} отправлен подумать над своим поведением — ответ правится до показа. (Нажми, чтобы не ждать.)`,
        { onclick: () => skip(id), timeOut: 9000 });
    try {
        while (hits.length && attempts < MAX_EDITS && !ctrl.signal.aborted) {
            attempts++;
            mark(id, `моем рот с мылом… правка ${attempts} из ${MAX_EDITS}`);
            let fixed = null;
            try {
                fixed = await editText(text, hits.map(h => h.word), ctrl.signal);
            } catch (e) {
                if (!ctrl.signal.aborted) console.warn('[Primal Catharsis] the edit failed:', e);
            }
            if (currentChat() !== chatId || ctx()?.chat?.[id] !== msg) return;   // the chat moved on — touch nothing
            if (!fixed) continue;
            text = fixed;
            hits = findPrimalDetailed(text);
            addCuts(bag, hits);
        }
    } finally {
        if (job?.ctrl === ctrl) job = null;
        unmark(id);
    }
    const aborted = ctrl.signal.aborted;
    const changed = text !== original;
    if (changed) applyText(id, msg, text);
    finalize(id, { cuts: bag, left: hits, attempts, orig: changed ? original : null });
    if (aborted) toast('info', 'Оставили как есть. Зверь сегодня ночует дома.');
    else if (!hits.length) toast('success', `Чисто. ${who()} научился выражаться словами через рот.`);
    else if (!changed) toast('warning', 'Редактор не справился — ответ оставлен как пришёл. Подробности в консоли (F12).');
    else toast('warning', `Зверь победил после ${attempts} правок (${hits.map(h => h.word).join(', ')}). Правьте руками или молитесь.`);
}

// ─── The edit itself ───
const BAN_SUMMARY = 'primal, primeval, feral, animalistic, beastly, predatory, possessive(ness), territorial, alpha, instinct(s), growling, snarling, animal hunger/need/desire, claiming or marking someone, "you\'re mine", "you belong to me"; первобытный, звериный, животный инстинкт/голод, хищный, рычать/рык, собственник/собственнический, «ты моя», «принадлежишь мне», пометить, альфа, дикий голод/дикая страсть';

// hidden comments and style/script blocks never go to the editor: they're swapped for ⟦n⟧ and put back after
function mask(text) {
    const keep = [];
    const masked = text.replace(/<!--[\s\S]*?-->|<(style|script)\b[\s\S]*?<\/\1>/gi, (m) => { keep.push(m); return `⟦${keep.length - 1}⟧`; });
    const restore = (out) => {
        for (let i = 0; i < keep.length; i++) if (out.split(`⟦${i}⟧`).length !== 2) return null;   // lost or doubled
        return out.replace(/⟦(\d+)⟧/g, (m, i) => keep[Number(i)] ?? m);
    };
    return { masked, restore };
}

function editPrompt(masked, words) {
    return [
        {
            role: 'system',
            content: `You are a meticulous line editor for roleplay prose. You get one message and a list of banned phrases.
Return the SAME message, changing only what is necessary:
- Rewrite every banned phrase, and any other "primal", animal-coded or possessive cliché, into natural human wording with the same meaning, tone, tense, point of view and language.
- Keep everything else exactly as it is: plot, dialogue, names, formatting, markdown, asterisks, quotes, HTML tags, line breaks, and placeholders like ⟦0⟧.
- Do not continue the story, do not shorten it, do not add comments.
Banned everywhere, in any language and form: ${BAN_SUMMARY}.
Output the whole edited message wrapped in <message></message> and nothing else.`,
        },
        { role: 'user', content: `Banned phrases found: ${words.map(w => `"${w}"`).join(', ')}.\n\n<message>\n${masked}\n</message>` },
    ];
}

function cleanEdit(raw, src) {
    let t = String(raw ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '');
    const m = t.match(/<message>\s*([\s\S]*?)\s*<\/message>/i);
    t = m ? m[1] : t.replace(/^\s*<message>\s*/i, '').replace(/\s*<\/message>\s*$/i, '');
    t = t.trim();
    if (!t) return null;
    if (src.length > 200) {                      // a refusal, a summary or a runaway continuation — not an edit
        const r = t.length / src.length;
        if (r < 0.5 || r > 1.8) return null;
    }
    return t;
}

// rejects as soon as the signal fires, even if the request underneath can't be cancelled
function guard(promise, signal) {
    return new Promise((resolve, reject) => {
        const stop = () => reject(new Error('отменено'));
        if (signal.aborted) return stop();
        signal.addEventListener('abort', stop, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
    });
}

async function requestProfile(profileId, messages, maxTokens, signal) {
    const svc = ctx()?.ConnectionManagerRequestService;
    if (!svc?.sendRequest) throw new Error('Connection Manager недоступен');
    const opts = { stream: false, signal, extractData: true, includePreset: true, includeInstruct: true };
    let res;
    try {
        res = await svc.sendRequest(profileId, messages, maxTokens, opts);
    } catch (e) {
        if (signal?.aborted) throw e;
        // some text-completion builds want a plain string instead of a message list
        res = await svc.sendRequest(profileId, messages.map(m => m.content).join('\n\n'), maxTokens, opts);
    }
    return typeof res === 'string' ? res : (res?.content ?? '');
}

// the main connection, the one the roleplay runs on
async function requestMain(messages, maxTokens) {
    const gr = ctx()?.generateRaw;
    if (typeof gr !== 'function') throw new Error('generateRaw недоступен в этой версии таверны');
    const [sys, user] = messages;
    // newer builds take one options object, older ones six positional arguments
    const res = gr.length <= 1
        ? await gr({ systemPrompt: sys.content, prompt: user.content, responseLength: maxTokens, trimNames: false })
        : await gr(user.content, '', false, false, sys.content, maxTokens);
    return typeof res === 'string' ? res : (res?.content ?? '');
}

async function editText(text, words, signal) {
    const { masked, restore } = mask(text);
    const messages = editPrompt(masked, words);
    const maxTokens = Math.min(8192, Math.ceil(masked.length / 2) + 300);
    const pid = settings().fixProfile;
    const viaProfile = pid && profiles()?.some(p => p.id === pid);
    const inner = new AbortController();
    const relay = () => inner.abort();
    signal.addEventListener('abort', relay, { once: true });
    const timer = setTimeout(relay, EDIT_TIMEOUT);
    try {
        const req = viaProfile ? requestProfile(pid, messages, maxTokens, inner.signal) : requestMain(messages, maxTokens);
        const body = cleanEdit(await guard(req, inner.signal), masked);
        return body ? restore(body) : null;
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', relay);
    }
}

function applyText(id, msg, text) {
    const c = ctx();
    msg.mes = text;
    if (Array.isArray(msg.swipes) && msg.swipes.length) msg.swipes[msg.swipe_id ?? 0] = text;
    const el = mesEl(id);
    if (!el) return;                                  // not drawn yet — the tavern will draw the fixed text itself
    try {
        if (typeof c.updateMessageBlock === 'function') c.updateMessageBlock(id, msg);
        else {
            const t = el.querySelector('.mes_text');
            if (t && c.messageFormatting) t.innerHTML = c.messageFormatting(text, msg.name, msg.is_system, msg.is_user, id);
        }
    } catch (e) {
        console.warn('[Primal Catharsis] could not redraw the message:', e);
    }
    // the tavern saves after the generation anyway; this is a safety net for the streaming path
    const chatId = currentChat();
    setTimeout(() => { if (currentChat() === chatId) ctx()?.saveChat?.(); }, 1500);
}

// ─── The report: what was cut ───
// The main copy lives on the message (and its swipe). A spare copy sits in the chat metadata,
// in case another extension rebuilds the message object or wipes its `extra`.
const stamp = (v) => {
    const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v);
    return Number.isFinite(t) ? String(t) : String(v ?? '');
};
const bkey = (msg) => `${stamp(msg.gen_finished || msg.gen_started || msg.send_date)}#${msg.swipe_id ?? 0}`;
function backup(create = false) {
    const md = ctx()?.chatMetadata;
    if (!md) return null;
    if (!create) return md[KEY]?.logs || null;
    md[KEY] ||= {};
    return (md[KEY].logs ||= {});
}

function putData(msg, data) {
    msg.extra ||= {};
    msg.extra[KEY] = data;
    const si = msg.swipe_info?.[msg.swipe_id ?? 0];
    if (si) { si.extra ||= {}; si.extra[KEY] = data; }
    const b = backup(true);
    if (b) {
        b[bkey(msg)] = { ...data, alt: undefined };
        const keys = Object.keys(b);
        for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete b[k];
    }
}
function dropData(msg) {
    if (msg.extra) delete msg.extra[KEY];
    const si = msg.swipe_info?.[msg.swipe_id ?? 0];
    if (si?.extra) delete si.extra[KEY];
    const b = backup();
    if (b) delete b[bkey(msg)];
}
function getData(msg) {
    if (!msg || msg.is_user || msg.is_system) return null;
    return msg.extra?.[KEY] || backup()?.[bkey(msg)] || null;
}
function patchData(msg, at, patch) {
    const all = [msg?.extra?.[KEY], ...(msg?.swipe_info || []).map(s => s?.extra?.[KEY]), ...Object.values(backup() || {})];
    for (const d of all) if (d?.at === at) Object.assign(d, patch);
}

function finalize(id, { cuts, left, attempts, orig }) {
    const msg = ctx()?.chat?.[id];
    if (!msg) return;
    const still = new Set(left.map(h => h.word.toLowerCase()));
    cuts = cuts.filter(c => !still.has(c.word.toLowerCase()));
    if (!cuts.length && !left.length) return;
    const data = {
        verdict: left.length ? 'beast' : 'clean',     // 'clean' — вырезали; 'beast' — прорвалось
        rewrites: attempts,
        name: who(),
        cuts: cuts.slice(0, 12),
        left: left.slice(0, 6).map(h => ({ ...h, count: 1 })),
        comment: null,
        by: '',
        at: Date.now(),
        alt: orig ? orig.slice(0, 60000) : null,      // the other version, for «вернуть как было»
        showingOrig: false,
    };
    putData(msg, data);
    renderSoon(id);
    roast(id, data);
}

// «вернуть как было» / «вернуть правку»: the two versions swap places
function swapVersion(id) {
    const c = ctx();
    const msg = c?.chat?.[id];
    const data = getData(msg);
    if (!msg || !data?.alt) return;
    const now = msg.mes;
    applyText(id, msg, data.alt);
    patchData(msg, data.at, { alt: now, showingOrig: !data.showingOrig });
    ensure(id);
    const E = c.event_types || {};
    if (E.MESSAGE_EDITED) c.eventSource?.emit?.(E.MESSAGE_EDITED, id);
    if (E.MESSAGE_UPDATED) c.eventSource?.emit?.(E.MESSAGE_UPDATED, id);
    toast('info', data.showingOrig ? 'Показан оригинал. Зверь на свободе — под твою ответственность.' : 'Правка возвращена. Намордник на месте.');
}

// ─── The Censor: a toxic one-liner, written through a separate connection profile ───
const roasting = new WeakSet();
const currentChat = () => { const c = ctx(); return c?.getCurrentChatId?.() ?? c?.chatId; };

function profiles() {
    const c = ctx();
    const cm = c?.extensionSettings?.connectionManager;
    if (!c?.ConnectionManagerRequestService || !cm || c.extensionSettings?.disabledExtensions?.includes('connection-manager')) return null;
    let list;
    try { list = c.ConnectionManagerRequestService.getSupportedProfiles?.(); } catch { /* older build */ }
    if (!Array.isArray(list)) list = cm.profiles || [];
    return list.map(p => ({ id: p.id, name: p.name || p.id, active: p.id === cm.selectedProfile }));
}

function roastPrompt(data) {
    const line = (c) => `- «${c.before}[${c.word}]${c.after}»${c.count > 1 ? ` (лезло ${c.count} раза)` : ''}`;
    const beast = data.verdict === 'beast';
    return [
        {
            role: 'system',
            content: 'Ты — Цензор из «Департамента по борьбе с рычанием»: желчный, уставший, остроумный литературный редактор. '
                + 'Тебе показывают звериные и собственнические штампы, которые персонаж ролевой переписки пытался протащить в ответ. '
                + 'Напиши ОДИН комментарий: 1–2 коротких предложения, не длиннее 35 слов, по-русски. '
                + 'Тон — смешной, токсичный, язвительный, мат уместен. Цепляйся за конкретные формулировки, высмеивай штампы и «авторский стиль» персонажа. '
                + 'Не задевай реальных людей и группы, никаких оскорблений по признакам. '
                + 'Выведи только сам комментарий: без кавычек, без вступления, без эмодзи.',
        },
        {
            role: 'user',
            content: `Персонаж: ${data.name}
Переписываний: ${data.rewrites}
Итог: ${beast ? 'персонаж так и не сдался, штампы остались в ответе' : 'после переписывания штампы вырезаны'}
${data.cuts.length ? `\nВырезанные фразы (запретное слово в квадратных скобках):\n${data.cuts.map(line).join('\n')}\n` : ''}${data.left.length ? `\nПрорвалось в итоговый ответ:\n${data.left.map(line).join('\n')}\n` : ''}
Комментарий:`,
        },
    ];
}

function tidy(raw) {
    let t = String(raw || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^\s*(?:комментарий|цензор)\s*[:—-]\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^["«“„']+|["»”']+$/g, '')
        .trim();
    if (t.length > 320) t = t.slice(0, 317).replace(/\s+\S*$/, '') + '…';
    return t;
}

async function askProfile(profileId, messages, maxTokens = 300, ms = 45000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return tidy(await guard(requestProfile(profileId, messages, maxTokens, ctrl.signal), ctrl.signal));
    } finally {
        clearTimeout(timer);
    }
}

const ROAST_CLEAN = [
    '«{word}» вырезано нахуй. {name}, теперь попробуй чувствовать без справочника по зоологии.',
    '{name} потянулся к «{word}» с уверенностью человека, прочитавшего три фанфика и решившего, что это литература.',
    'Удалено: «{word}». Это ролевуха, а не документалка с Animal Planet.',
    '{name} выдал «{word}». Пиздец как свежо — почти как предыдущие четыреста раз.',
    'Минус «{word}». Словарный запас {name} официально шире, чем у волка. Совсем чуть-чуть.',
    '«{word}» отправлено обратно в лес, откуда пришло. {name}, ты не в стае, ты в диалоге.',
    'Если бы штампы облагались налогом, {name} уже сидел бы за долги. Начиная с «{word}».',
    'Пара переписываний — и {name} внезапно вспомнил, что у людей есть слова. Аплодируем медленно.',
];
const ROAST_BEAST = [
    'Переписывали, переписывали — и всё равно «{word}». {name}, это уже не стиль, это диагноз.',
    '«{word}» прорвалось. Модель держалась за него так, будто это её последняя мысль. Возможно, так и есть.',
    'Мы сделали всё, что могли. «{word}» осталось. Редактируй руками или вызывай ветеринара.',
    '{name} выбрал «{word}» вместо человеческой речи. Повторно. Осознанно. Позорище.',
];

function hash(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; }

function canned(data) {
    const beast = data.verdict === 'beast' && data.left?.length;
    const pool = beast ? ROAST_BEAST : ROAST_CLEAN;
    const src = beast ? data.left : data.cuts;
    const top = [...(src || [])].sort((a, b) => (b.count || 1) - (a.count || 1))[0];
    const w = top?.word || 'это';
    return pool[hash(`${data.at}|${w}`) % pool.length].replaceAll('{name}', data.name || who()).replaceAll('{word}', w);
}

async function roast(id, data) {
    const chatId = currentChat();
    const msg = ctx()?.chat?.[id];
    const pid = settings().commentProfile;
    const usable = pid && profiles()?.some(p => p.id === pid);
    let text = '';
    let by = 'canned';
    if (usable) {
        roasting.add(data);
        renderSoon(id);
        try {
            text = await askProfile(pid, roastPrompt(data));
            by = profiles()?.find(p => p.id === pid)?.name || 'нейронка';
        } catch (e) {
            console.warn('[Primal Catharsis] commentator failed:', e);
        }
        roasting.delete(data);
    }
    if (!text) { text = canned(data); by = pid ? 'fallback' : 'canned'; }
    if (currentChat() !== chatId) return;          // the player switched chats meanwhile
    patchData(msg, data.at, { comment: text, by });
    if (usable) ctx()?.saveChat?.();               // the reply was saved long ago; save the late comment too
    if (ctx()?.chat?.[id] === msg) ensure(id, { typed: true });
}

// ─── The report in the chat ───
const plural = (n, [one, few, many]) => {
    const a = n % 100, b = n % 10;
    return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const calm = () => {
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    const v = getComputedStyle(document.documentElement).getPropertyValue('--animation-duration').trim();
    return v === '0ms' || v === '0s' || v === '0';
};

function logHtml(data) {
    const beast = data.verdict === 'beast' && data.left.length;
    const cut = data.cuts;
    const left = data.left || [];
    const shown = beast ? left : cut;
    const words = shown.map(c => esc(c.word) + (c.count > 1 ? ` ×${c.count}` : '')).join(', ');
    const title = beast ? `Прорвалось ${left.length}` : `Вырезано ${cut.length}`;
    const meta = data.rewrites ? `${data.rewrites} ${plural(data.rewrites, ['правка', 'правки', 'правок'])}` : '';
    const q = (c, inner) => `<span class="pc-q">«${esc(c.before)}${inner}${esc(c.after)}»</span>`;
    const items = [
        ...cut.map((c, i) => `<li style="--i:${i}">${q(c, `<span class="pc-cut">${esc(c.word)}</span>`)}${c.count > 1 ? `<b class="pc-times">×${c.count}</b>` : ''}</li>`),
        ...left.map((c, i) => `<li class="pc-li-left" style="--i:${cut.length + i}">${q(c, `<mark class="pc-left">${esc(c.word)}</mark>`)}<span class="pc-tag">прорвалось</span></li>`),
    ];
    const undo = data.alt ? '<div class="pc-log-tools"><button type="button" class="pc-undo" data-pc-undo><i class="fa-solid fa-rotate-left"></i><span>Вернуть как было</span></button></div>' : '';
    return `
        <button type="button" class="pc-log-head" aria-expanded="false" title="Показать формулировки">
            <i class="fa-solid ${beast ? 'fa-paw' : 'fa-scissors'} pc-log-ico"></i>
            <span class="pc-log-title">${title}</span>
            <span class="pc-log-words">${words}</span>
            <span class="pc-log-orig">оригинал</span>
            ${meta ? `<span class="pc-log-meta">${meta}</span>` : ''}
            <i class="fa-solid fa-chevron-down pc-log-chev"></i>
        </button>
        <div class="pc-log-body"><div class="pc-log-inner"><ul class="pc-log-list">${items.join('')}</ul>${undo}</div></div>
        <div class="pc-log-comment"><i class="fa-solid fa-user-tie"></i><div class="pc-log-say"></div></div>`;
}

function paintUndo(box, data) {
    box.classList.toggle('pc-orig', !!data.showingOrig);
    const label = box.querySelector('.pc-undo span');
    const want = data.showingOrig ? 'Вернуть правку' : 'Вернуть как было';
    if (label && label.textContent !== want) label.textContent = want;
}

function byLabel(by) {
    if (by === 'canned') return '— Цензор, по методичке';
    if (by === 'fallback') return '— Цензор, по методичке (комментатор не ответил)';
    return `— Цензор · ${esc(by)}`;
}

// typing without growing: the whole text is laid out from the start, the untyped rest is just invisible
function typeInto(el, text) {
    el.innerHTML = '<span class="pc-typed"></span><span class="pc-ghost"></span>';
    const [typed, ghost] = el.children;
    ghost.textContent = text;
    el.classList.add('pc-typing');
    let i = 0;
    const step = Math.max(1, Math.round(text.length / 60));
    const done = () => { el.textContent = text; el.classList.remove('pc-typing'); };
    const tick = () => {
        if (!el.isConnected) return done();
        i = Math.min(text.length, i + step);
        typed.textContent = text.slice(0, i);
        ghost.textContent = text.slice(i);
        if (i < text.length) setTimeout(tick, 22);
        else done();
    };
    tick();
}

function paintComment(box, data, state, typed) {
    const say = box.querySelector('.pc-log-say');
    box.dataset.state = state;
    if (state === 'wait') {
        say.innerHTML = '<span class="pc-log-text pc-wait"><span class="pc-dots"><i></i><i></i><i></i></span>Цензор подбирает выражения…</span>';
        return;
    }
    const text = data.comment || canned(data);
    say.innerHTML = `<span class="pc-log-text"></span><small class="pc-log-by">${byLabel(state === 'cold' ? 'canned' : data.by)}</small>`;
    const t = say.querySelector('.pc-log-text');
    if (typed && !calm()) typeInto(t, text);
    else t.textContent = text;
    say.classList.remove('pc-pop');
    void say.offsetWidth;
    say.classList.add('pc-pop');
}

// One live element per report, reused forever: if someone throws it out of the message,
// the very same node goes back — with its open/closed state, typing and all, and without replaying the entrance.
const nodes = new Map();      // data.at → element
const moves = new WeakMap();  // element → { pushed, back, since } — so we never get into a tug-of-war with another extension

function nodeFor(data) {
    let box = nodes.get(data.at);
    if (box) return box;
    box = document.createElement('div');
    box.className = 'pc-log' + (data.verdict === 'beast' && data.left.length ? ' pc-beast' : '');
    box.dataset.at = String(data.at);
    box.innerHTML = logHtml(data);
    box.addEventListener('animationend', (e) => { if (e.target === box) box.classList.add('pc-still'); });
    nodes.set(data.at, box);
    if (nodes.size > 300) nodes.delete(nodes.keys().next().value);
    return box;
}

// the fixed spot: right under the name row, above reasoning, pictures, other infoblocks and the text itself
function place(el, box) {
    const block = el.querySelector('.mes_block');
    if (!block) return;
    const anchor = block.querySelector(':scope > .ch_name');
    const inPlace = box.parentNode === block && (anchor ? box.previousElementSibling === anchor : block.firstElementChild === box);
    if (inPlace) return;
    const now = Date.now();
    const g = moves.get(box) || { pushed: 0, back: 0, since: now };
    if (now - g.since > 2000) { g.pushed = 0; g.back = 0; g.since = now; }
    moves.set(box, g);
    if (box.parentNode === block) {
        // someone keeps squeezing in above us — after a few rounds, stay right next to them instead of fighting
        if (g.pushed >= 4) return;
        g.pushed++;
    } else {
        if (g.back >= 12) return;   // something deletes us in a loop — give up for a moment rather than spin
        g.back++;
    }
    if (box.dataset.shown) box.classList.add('pc-still');   // a return, not a first appearance
    box.dataset.shown = '1';
    if (anchor) anchor.after(box);
    else block.prepend(box);
}

/** Make the message show exactly what it should: its own report in its spot, nothing stray */
function ensure(id, { typed = false } = {}) {
    const el = mesEl(id);
    if (!el) return;
    if (shamedId === id) mark(id, shamedLabel);
    const data = getData(ctx()?.chat?.[id]);
    const show = !!data && !!(data.cuts?.length || data.left?.length) && settings().showLog !== false;
    let box = null;
    if (show) {
        data.cuts ||= [];
        data.left ||= [];
        box = nodeFor(data);
        const state = data.comment ? 'done' : roasting.has(data) ? 'wait' : 'cold';
        if (box.dataset.state !== state || typed) paintComment(box, data, state, typed);
        paintUndo(box, data);
    }
    for (const b of el.querySelectorAll('.pc-log')) if (b !== box) b.remove();   // old swipes, copies of copies
    if (box) place(el, box);
}

const renderSoon = (id) => setTimeout(() => ensure(id), 0);
function renderAll() {
    document.querySelectorAll('#chat .mes[mesid]').forEach(el => ensure(Number(el.getAttribute('mesid'))));
}

// Watches the chat for anyone rewriting messages. Observer callbacks run before the browser paints,
// so a block that got knocked out is back before it could ever be seen missing.
function watchChat() {
    const chat = document.getElementById('chat');
    if (!chat) return void setTimeout(watchChat, 500);
    new MutationObserver((muts) => {
        const touched = new Set();
        for (const m of muts) {
            const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
            if (!t || t.closest('.pc-log, .pc-soap')) continue;  // our own typing, toggles and soap
            const mes = t.closest('.mes');
            if (mes) { touched.add(mes); continue; }
            for (const n of m.addedNodes) {                       // whole messages added or replaced
                if (n.nodeType !== 1) continue;
                if (n.matches('.mes')) touched.add(n);
                else n.querySelectorAll?.('.mes').forEach(x => touched.add(x));
            }
        }
        for (const mes of touched) {
            const id = Number(mes.getAttribute('mesid'));
            if (Number.isFinite(id)) ensure(id);
        }
    }).observe(chat, { childList: true, subtree: true });
}

const tMs = () => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--animation-duration').trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? (v.endsWith('ms') ? n : n * 1000) : 125;
};

function onChatClick(e) {
    const t = e.target;
    if (!t?.closest) return;
    const skipBtn = t.closest('[data-pc-skip]');
    if (skipBtn) {
        const id = Number(skipBtn.closest('.mes')?.getAttribute('mesid'));
        if (Number.isFinite(id)) skip(id);
        return;
    }
    const undo = t.closest('[data-pc-undo]');
    if (undo) {
        const id = Number(undo.closest('.mes')?.getAttribute('mesid'));
        if (Number.isFinite(id)) swapVersion(id);
        return;
    }
    const head = t.closest('.pc-log-head');
    if (!head) return;
    const box = head.closest('.pc-log');
    const open = !box.classList.contains('pc-open');
    box.classList.toggle('pc-open', open);
    head.setAttribute('aria-expanded', String(open));
    // the strike-through show plays only right after a click, so moving the block never replays it
    clearTimeout(box._pcOpening);
    box.classList.remove('pc-opening');
    if (open && !calm()) {
        void box.offsetWidth;
        box.classList.add('pc-opening');
        const n = box.querySelectorAll('.pc-log-list li').length;
        box._pcOpening = setTimeout(() => box.classList.remove('pc-opening'), (n * 0.6 + 6) * tMs());
    }
}

// ─── The menu (magic wand) and the very serious bottom sheet ───
function updateMenu(bump = false) {
    const item = document.getElementById('pc-menu-item');
    if (!item) return;
    const pill = item.querySelector('.pc-menu-state');
    pill.textContent = isOn() ? 'ВКЛ' : 'ВЫКЛ';
    item.classList.toggle('pc-off', !isOn());
    if (bump) { pill.classList.remove('pc-bump'); void pill.offsetWidth; pill.classList.add('pc-bump'); }
}

function addMenu() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('pc-menu-item')) return !!menu;
    const item = document.createElement('div');
    item.id = 'pc-menu-item';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-paw extensionsMenuExtensionButton"></div><span>Primal Catharsis</span><b class="pc-menu-state"></b>';
    item.addEventListener('click', openPopup);
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPopup(); } });
    menu.appendChild(item);
    updateMenu();
    return true;
}

function profileOptions(cur, emptyLabel) {
    const list = profiles() || [];
    const opts = [`<option value="">${emptyLabel}</option>`];
    for (const p of list) opts.push(`<option value="${esc(p.id)}"${p.id === cur ? ' selected' : ''}>${esc(p.name)}${p.active ? ' (сейчас в РП)' : ''}</option>`);
    if (cur && !list.some(p => p.id === cur)) opts.push(`<option value="${esc(cur)}" selected>Удалённый профиль</option>`);
    return opts.join('');
}

function fixHint() {
    const pid = settings().fixProfile;
    const list = profiles();
    if (!list) return 'Connection Manager выключен — правит основное подключение, то же, что и РП.';
    if (!pid) return 'Правит основное подключение, то же, что и РП. Ответ исправляется до того, как его увидят чат и другие расширения.';
    const p = list.find(x => x.id === pid);
    if (!p) return 'Этого профиля больше нет — правит основное подключение.';
    if (p.active) return 'Это профиль, который сейчас в РП, — то же самое, что основное подключение.';
    return 'Правка идёт отдельным запросом через этот профиль. Быстрая недорогая модель — меньше ждать; РП-подключение не трогается.';
}

function commentHint() {
    const pid = settings().commentProfile;
    const list = profiles();
    if (!list) return 'Connection Manager выключен или таверна слишком старая — Цензор шутит заготовками.';
    if (!pid) return 'Без профиля Цензор шутит заготовками. Выбери профиль — и он начнёт издеваться над конкретными цитатами.';
    const p = list.find(x => x.id === pid);
    if (!p) return 'Этого профиля больше нет — пока шутим заготовками.';
    if (p.active) return 'Это тот же профиль, что сейчас в РП: сработает, но тратит ту же квоту. Лучше отдельный — подешевле и побыстрее.';
    return 'Комментарий пишется отдельным тихим запросом через этот профиль. РП-подключение, модель и пресет не переключаются.';
}

function popupHtml() {
    const s = settings();
    const cm = !!profiles();
    return `
        <div class="pc-card">
            <div class="pc-tape" aria-hidden="true"></div>
            <button type="button" class="pc-x" data-pc="close" aria-label="Закрыть" title="Закрыть (Esc)"><i class="fa-solid fa-xmark"></i></button>
            <div class="pc-stamp" aria-hidden="true"><i class="fa-solid fa-stamp"></i>ПРОВЕРЕНО<br>НЕ ВОЛК</div>
            <div class="pc-kicker pc-in" style="--i:0"><i class="fa-solid fa-triangle-exclamation"></i> Департамент по борьбе с рычанием, форма 13‑Б</div>
            <h2 id="pc-title" class="pc-in" style="--i:1"><i class="fa-solid fa-paw pc-wig" aria-hidden="true"></i> Primal Catharsis <i class="fa-solid fa-ban pc-wig" aria-hidden="true"></i></h2>
            <p class="pc-body pc-in" style="--i:2">Наши датчики засекли персонажа по имени <b>${esc(who())}</b>, который в любой момент может <i>собственнически зарычать</i>, назвать кого-нибудь <i>«моей»</i> и испытать что-то <i>первобытное</i> к дверному косяку. Как поступим?</p>
            <div class="pc-status" aria-live="polite"></div>
            <div class="pc-seg pc-in" style="--i:3" role="radiogroup" aria-label="Режим цензуры">
                <button type="button" class="pc-seg-btn" role="radio" data-pc="on"><i class="fa-solid fa-bone"></i><span>Надеть намордник</span><small>включить</small></button>
                <button type="button" class="pc-seg-btn" role="radio" data-pc="off"><i class="fa-solid fa-moon"></i><span>Пусть воет</span><small>выключить</small></button>
            </div>
            <div class="pc-section pc-in" style="--i:4">
                <div class="pc-row pc-between">
                    <span id="pc-stream-label"><i class="fa-solid fa-eye-slash"></i> Прятать пойманное ещё во время стриминга</span>
                    <button type="button" class="pc-switch" role="switch" data-pc="stream" aria-labelledby="pc-stream-label"></button>
                </div>
                <div class="pc-row pc-between">
                    <span id="pc-log-label"><i class="fa-solid fa-scissors"></i> Сводка «вырезано» над сообщениями</span>
                    <button type="button" class="pc-switch" role="switch" data-pc="log" aria-labelledby="pc-log-label"></button>
                </div>
                <div>
                    <label for="pc-fix" class="pc-label"><i class="fa-solid fa-pen-nib"></i> Редактор: кто исправляет ответ</label>
                    <select id="pc-fix" class="text_pole pc-select" data-pc-set="fixProfile">${profileOptions(s.fixProfile, 'Основное подключение (как в РП)')}</select>
                    <small class="pc-hint" data-for="fix"></small>
                </div>
                <div>
                    <label for="pc-comment" class="pc-label"><i class="fa-solid fa-user-tie"></i> Цензор-комментатор: профиль подключения</label>
                    <div class="pc-row">
                        <select id="pc-comment" class="text_pole pc-select" data-pc-set="commentProfile"${cm ? '' : ' disabled'}>${profileOptions(s.commentProfile, cm ? 'Без нейронки — по методичке' : 'Connection Manager недоступен — по методичке')}</select>
                        <button type="button" class="pc-mini" data-pc="test" title="Отправить тестовую цитату Цензору"><i class="fa-solid fa-hand-point-right"></i><span>Пнуть</span></button>
                    </div>
                    <small class="pc-hint" data-for="comment"></small>
                </div>
            </div>
            <p class="pc-fine pc-in" style="--i:5">Возможные побочные эффекты: эмоциональная зрелость, законченные предложения и внезапный страх слова «самка».</p>
        </div>`;
}

function paintPopup(wrap, flip = false) {
    const on = isOn();
    const s = settings();
    const st = wrap.querySelector('.pc-status');
    st.className = `pc-status ${on ? 'pc-is-on' : 'pc-is-off'}`;
    st.innerHTML = on
        ? '<i class="fa-solid fa-fire-extinguisher"></i><span>Статус: <b>зверь в наморднике.</b> Люди разговаривают как люди.</span>'
        : '<i class="fa-solid fa-moon"></i><span>Статус: <b>на свободе.</b> Где-то первобытно сжимается челюсть.</span>';
    if (flip) { void st.offsetWidth; st.classList.add('pc-flip'); }
    const seg = wrap.querySelector('.pc-seg');
    seg.dataset.state = on ? 'on' : 'off';
    seg.querySelectorAll('[role="radio"]').forEach(b => b.setAttribute('aria-checked', String((b.dataset.pc === 'on') === on)));
    wrap.querySelector('[data-pc="log"]').setAttribute('aria-checked', String(s.showLog !== false));
    wrap.querySelector('[data-pc="stream"]').setAttribute('aria-checked', String(s.hideStream !== false));
    wrap.querySelector('.pc-hint[data-for="fix"]').textContent = fixHint();
    wrap.querySelector('.pc-hint[data-for="comment"]').textContent = commentHint();
}

async function testRoast(btn) {
    if (btn.getAttribute('aria-busy') === 'true') return;
    const old = btn.innerHTML;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Пинаю…</span>';
    const data = {
        verdict: 'clean', rewrites: 1, name: who(), at: Date.now(), left: [],
        cuts: [
            { word: 'первобытный', before: 'В его глазах вспыхнул ', after: ' голод.', count: 1 },
            { word: 'ты моя', before: '— Запомни: ', after: '.', count: 2 },
        ],
    };
    const pid = settings().commentProfile;
    try {
        const text = pid ? await askProfile(pid, roastPrompt(data)) : canned(data);
        toast('info', text || 'Цензор промолчал. Проверь, что профиль вообще отвечает.');
    } catch (e) {
        toast('error', `Комментатор не отвечает: ${e?.message || e}`);
    } finally {
        btn.removeAttribute('aria-busy');
        btn.innerHTML = old;
    }
}

function openPopup() {
    try {
        showPopup();
    } catch (e) {
        console.error('[Primal Catharsis] the panel failed to open:', e);
        toast('error', `Панель не открылась: ${e?.message || e}`);
    }
}

// A native modal <dialog>: it opens in the browser's top layer, so no z-index, transform or
// stacking context of the tavern (or of a theme) can hide it or shove it off the screen.
function showPopup() {
    const old = document.getElementById('pc-popup');
    if (old) { try { old.close?.(); } catch { /* already closed */ } old.remove(); }
    const s = settings();
    const dlg = document.createElement('dialog');
    dlg.id = 'pc-popup';
    dlg.setAttribute('aria-labelledby', 'pc-title');
    dlg.innerHTML = popupHtml();
    let closing = false;
    const close = () => {
        if (closing) return;
        closing = true;
        dlg.classList.add('pc-bye');
        setTimeout(() => {
            releaseToasts(dlg);
            try { dlg.close(); } catch { /* fine */ }
            dlg.remove();
        }, calm() ? 0 : 220);
    };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });   // Esc, or the back gesture on Android
    dlg.addEventListener('click', (e) => {
        if (e.target === dlg) return close();                                  // a tap on the dimmed area
        const btn = e.target.closest('[data-pc]');
        const act = btn?.dataset.pc;
        if (act === 'close') close();
        else if (act === 'on' || act === 'off') {
            const want = act === 'on';
            if (want === isOn()) return;
            setOn(want);
            paintPopup(dlg, true);
            toast(want ? 'success' : 'info', want
                ? 'Зверь в наморднике. Рычание теперь административное правонарушение.'
                : 'Зверь на свободе. Пусть ваши возлюбленные хотя бы перестанут обнюхивать людей.');
        } else if (act === 'log') {
            s.showLog = s.showLog === false;
            saveSettings();
            paintPopup(dlg);
            renderAll();
        } else if (act === 'stream') {
            s.hideStream = s.hideStream === false;
            saveSettings();
            paintPopup(dlg);
        } else if (act === 'test') testRoast(btn);
    });
    dlg.addEventListener('change', (e) => {
        const key = e.target.dataset?.pcSet;
        if (!key) return;
        s[key] = e.target.value;
        saveSettings();
        paintPopup(dlg);
    });
    document.body.appendChild(dlg);
    paintPopup(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');                                         // very old browsers
    dlg.querySelector('.pc-seg-btn[aria-checked="true"]')?.focus({ preventScroll: true });
}

// a second way in, in case the wand menu misbehaves on some theme or phone: type /primal
function addCommand() {
    const c = ctx();
    const run = () => { openPopup(); return ''; };
    try {
        if (c.SlashCommandParser?.addCommandObject && c.SlashCommand?.fromProps) {
            c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({ name: 'primal', callback: run, helpString: 'Открыть панель Primal Catharsis.' }));
        } else {
            c.registerSlashCommand?.('primal', run, [], '– открыть панель Primal Catharsis', true, true);
        }
    } catch (e) {
        console.warn('[Primal Catharsis] /primal was not registered:', e);
    }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// ─── Start ───
function init() {
    const c = ctx();
    if (!c) return void setTimeout(init, 500);
    settings();
    const { eventSource, event_types: E } = c;
    // first in line for «message received»: the tavern waits for us before it shows the reply
    // and before any other extension gets its hands on it
    const onRecv = (id, type) => onReceived(Number(id), type);
    eventSource.on(E.MESSAGE_RECEIVED, onRecv);
    const queue = eventSource.events?.[E.MESSAGE_RECEIVED];
    if (Array.isArray(queue)) { const i = queue.indexOf(onRecv); if (i > 0) { queue.splice(i, 1); queue.unshift(onRecv); } }

    if (E.STREAM_TOKEN_RECEIVED) eventSource.on(E.STREAM_TOKEN_RECEIVED, onStreamToken);
    if (E.GENERATION_STARTED) eventSource.on(E.GENERATION_STARTED, (type, _opts, dryRun) => { if (!dryRun) { genType = type; streamCheckAt = 0; } });
    if (E.GENERATION_ENDED) eventSource.on(E.GENERATION_ENDED, release);
    // the stop button during an edit means «stop waiting»: keep the reply as it came
    if (E.GENERATION_STOPPED) eventSource.on(E.GENERATION_STOPPED, () => { job?.ctrl.abort(); release(); });
    eventSource.on(E.CHAT_CHANGED, () => { job?.ctrl.abort(); job = null; skipped.clear(); shamedId = null; inject(); setTimeout(renderAll, 60); });
    for (const ev of [E.CHARACTER_MESSAGE_RENDERED, E.MESSAGE_SWIPED, E.MESSAGE_UPDATED, E.MESSAGE_EDITED]) {
        if (ev) eventSource.on(ev, (id) => renderSoon(Number(id)));
    }
    for (const ev of [E.MESSAGE_DELETED, E.MORE_MESSAGES_LOADED]) {
        if (ev) eventSource.on(ev, () => setTimeout(renderAll, 0));
    }
    document.addEventListener('click', onChatClick);
    unshame();
    inject();
    addCommand();
    watchChat();
    renderAll();
    // the wand menu appears a little later than us
    const tryMenu = (n = 0) => { if (!addMenu() && n < 40) setTimeout(() => tryMenu(n + 1), 250); };
    tryMenu();
}

if (globalThis.jQuery) jQuery(init); else init();
