// Primal Catharsis — запрет «первобытных», звериных и собственнических штампов.
// 1) Правило в самом начале промпта (на английском). 2) Каждый ответ бота проверяется; пролезло — свайп и переписывание.
// Интерфейс — на русском, значки — Font Awesome.

const KEY = 'primal_catharsis';
const RULE_KEY = 'primal_catharsis_rule';
const NUDGE_KEY = 'primal_catharsis_nudge';
const SHAME_KEY = 'primal_catharsis_shame';
const MAX_REWRITES = 2;

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

/** All banned phrases in a text (hidden comments and markup ignored) */
export function findPrimal(text) {
    const t = String(text || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
    const hits = [];
    for (const re of BANNED) {
        const m = t.match(re);
        if (m && !hits.some(h => h.toLowerCase() === m[0].toLowerCase())) hits.push(m[0].trim());
    }
    return hits;
}

// ─── Settings ───
function settings() {
    const c = ctx();
    if (!c) return { enabled: true };
    c.extensionSettings[KEY] = c.extensionSettings[KEY] || { enabled: true };
    return c.extensionSettings[KEY];
}
const isOn = () => settings().enabled !== false;
function setOn(v) {
    settings().enabled = !!v;
    ctx()?.saveSettingsDebounced?.();
    inject();
    updateMenu();
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

// ─── Catch and rewrite ───
const tries = new Map();     // message index → rewrites done
let pending = null;          // { id, hits } — a rewrite waiting for the generation to finish

function shame(hits) {
    ctx()?.setExtensionPrompt?.(SHAME_KEY, `[PRIMAL CATHARSIS — YOUR LAST ATTEMPT WAS REJECTED]
It used: ${hits.map(h => `"${h}"`).join(', ')}. That is exactly what is banned. Write this reply again from scratch — same events, same intent — with none of these words, none of their forms and nothing that paints ${charName()} as an animal.`, POS.IN_CHAT, 0, false, ROLE_SYSTEM);
}
const unshame = () => ctx()?.setExtensionPrompt?.(SHAME_KEY, '', POS.IN_CHAT, 0);

function mesEl(id) { return document.querySelector(`#chat .mes[mesid="${id}"]`); }

function onReceived(id) {
    if (!isOn()) return;
    const c = ctx();
    const msg = c?.chat?.[id];
    unshame();
    // the greeting (message 0) is the card's own text — swiping it would just flip alternate greetings
    if (!msg || msg.is_user || msg.is_system || id === 0) return;
    const hits = findPrimal(msg.mes);
    if (!hits.length) {
        if (tries.get(id)) toast('success', `Чисто. ${who()} научился выражаться словами через рот.`);
        unmark(id);
        return;
    }
    const n = tries.get(id) || 0;
    if (n >= MAX_REWRITES) {
        toast('warning', `Зверь победил после ${MAX_REWRITES} переписываний (${hits.join(', ')}). Правьте руками или молитесь.`);
        unmark(id);
        return;
    }
    tries.set(id, n + 1);
    pending = { id, hits };
    console.info('[Primal Catharsis] caught:', hits);
    toast('error', `Обнаружено первобытное поведение: ${hits.map(h => `«${h}»`).join(', ')}. ${who()} отправлен подумать над своим поведением… (переписывание ${n + 1} из ${MAX_REWRITES})`);
    whenIdle(rewrite);
}

// the generation has to finish before we can swipe
function whenIdle(fn) {
    const started = Date.now();
    const tick = () => {
        const stop = document.getElementById('mes_stop');
        const busy = stop && getComputedStyle(stop).display !== 'none';
        if (!busy || Date.now() - started > 15000) setTimeout(fn, 250);
        else setTimeout(tick, 150);
    };
    tick();
}

function rewrite() {
    if (!pending) return;
    const { id, hits } = pending;
    pending = null;
    const c = ctx();
    if (!c || id !== c.chat.length - 1) return;      // the player has moved on
    mark(id);
    shame(hits);
    // a new swipe on the last message = a rewrite (the button does all the bookkeeping)
    const btn = document.querySelector('#chat .last_mes .swipe_right');
    if (btn) btn.click();
    else if (typeof c.swipe?.right === 'function') c.swipe.right();
    else { unshame(); unmark(id); toast('warning', 'Не получилось перелистнуть ответ — перепишите его сами.'); }
}

// пойманный ответ ждёт переписывания размытым, с плашкой поверх
function mark(id) {
    const el = mesEl(id);
    if (!el) return;
    el.classList.add('pc-shamed');
    const block = el.querySelector('.mes_block');
    if (block && !block.querySelector('.pc-soap')) {
        const tag = document.createElement('div');
        tag.className = 'pc-soap';
        tag.innerHTML = '<i class="fa-solid fa-soap"></i><span>моем рот с мылом…</span>';
        block.appendChild(tag);
    }
}
function unmark(id) {
    const el = mesEl(id);
    el?.classList.remove('pc-shamed');
    el?.querySelector('.pc-soap')?.remove();
}

function toast(kind, text) {
    const t = globalThis.toastr;
    if (t?.[kind]) t[kind](text, 'Primal Catharsis', { timeOut: 6000 });
}

// ─── The menu (magic wand) and the very serious popup ───
function updateMenu() {
    const item = document.getElementById('pc-menu-item');
    if (!item) return;
    item.querySelector('.pc-menu-state').textContent = isOn() ? 'ВКЛ' : 'ВЫКЛ';
    item.classList.toggle('pc-off', !isOn());
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

function openPopup() {
    document.getElementById('pc-popup')?.remove();
    const on = isOn();
    const wrap = document.createElement('div');
    wrap.id = 'pc-popup';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'pc-title');
    wrap.innerHTML = `
        <div class="pc-card">
            <div class="pc-tape" aria-hidden="true"></div>
            <button class="pc-x" data-pc="close" aria-label="Закрыть">Я подумаю (нет) <i class="fa-solid fa-xmark"></i></button>
            <div class="pc-kicker"><i class="fa-solid fa-triangle-exclamation"></i> Департамент по борьбе с рычанием · Форма 13‑Б</div>
            <h2 id="pc-title"><i class="fa-solid fa-paw pc-wig" aria-hidden="true"></i> PRIMAL CATHARSIS <i class="fa-solid fa-ban pc-wig" aria-hidden="true"></i></h2>
            <p class="pc-body">Наши датчики засекли персонажа по имени <b>${esc(who())}</b>, который в любой момент может <i>собственнически зарычать</i>, назвать кого-нибудь <i>«моей»</i> и испытать что-то <i>первобытное</i> к дверному косяку. Как поступим?</p>
            <div class="pc-status ${on ? 'pc-is-on' : 'pc-is-off'}">${on
                ? '<i class="fa-solid fa-fire-extinguisher"></i><span>Статус: <b>ЗВЕРЬ В НАМОРДНИКЕ.</b> Люди разговаривают как люди.</span>'
                : '<i class="fa-solid fa-moon"></i><span>Статус: <b>НА СВОБОДЕ.</b> Где-то первобытно сжимается челюсть.</span>'}</div>
            <div class="pc-buttons">
                <button class="pc-btn pc-btn-on" data-pc="on"><i class="fa-solid fa-bone"></i>Надеть намордник<small>включить</small></button>
                <button class="pc-btn pc-btn-off" data-pc="off"><i class="fa-solid fa-moon"></i>Пусть воет<small>выключить</small></button>
            </div>
            <p class="pc-fine">Возможные побочные эффекты: эмоциональная зрелость, законченные предложения и внезапный страх слова «самка».</p>
            <div class="pc-stamp" aria-hidden="true"><i class="fa-solid fa-stamp"></i> ПРОВЕРЕНО<br>НЕ ВОЛК</div>
        </div>`;
    const close = () => { wrap.classList.add('pc-bye'); setTimeout(() => wrap.remove(), 220); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('click', (e) => {
        if (e.target === wrap) return close();
        const act = e.target.closest('[data-pc]')?.dataset.pc;
        if (act === 'close') close();
        if (act === 'on' || act === 'off') {
            setOn(act === 'on');
            toast(act === 'on' ? 'success' : 'info', act === 'on'
                ? 'Зверь в наморднике. Рычание теперь административное правонарушение.'
                : 'Зверь на свободе. Пусть ваши возлюбленные хотя бы перестанут обнюхивать людей.');
            close();
        }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector(on ? '.pc-btn-off' : '.pc-btn-on')?.focus();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// ─── Start ───
function init() {
    const c = ctx();
    if (!c) return void setTimeout(init, 500);
    const { eventSource, event_types: E } = c;
    eventSource.on(E.MESSAGE_RECEIVED, (id) => onReceived(Number(id)));
    eventSource.on(E.MESSAGE_SENT, () => { tries.clear(); pending = null; unshame(); });
    eventSource.on(E.CHAT_CHANGED, () => { tries.clear(); pending = null; unshame(); inject(); });
    if (E.GENERATION_STOPPED) eventSource.on(E.GENERATION_STOPPED, () => { pending = null; unshame(); });
    inject();
    // the wand menu appears a little later than us
    const tryMenu = (n = 0) => { if (!addMenu() && n < 40) setTimeout(() => tryMenu(n + 1), 250); };
    tryMenu();
}

if (globalThis.jQuery) jQuery(init); else init();
