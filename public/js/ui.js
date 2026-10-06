// DOM helpers for the 2D overlay. User-provided text is only ever set via textContent.
const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

export function toast(message, kind = '') {
  const node = el('div', { className: `toast ${kind}`, textContent: message });
  $('toasts').append(node);
  setTimeout(() => node.remove(), 4000);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

export function setStatus(state) {
  const node = $('status');
  node.textContent = state === 'online' ? 'online' : 'reconnecting…';
  node.className = `pill ${state === 'online' ? 'ok' : 'down'}`;
}

export function setScore(player) {
  $('score').textContent = `⭐ ${player.points} pts · ${player.connections.length} connections`;
}

export function setRoomName(name) {
  $('room-name').textContent = `📍 ${name}`;
}

export function renderBoard(list, selfId) {
  $('board').replaceChildren(
    ...list.map((p) => {
      const swatch = el('span', { className: 'swatch' });
      swatch.style.background = p.color;
      const where = p.room ? [el('span', { className: 'where', textContent: ` · 🟢 ${p.room}` })] : [];
      return el('li', { className: p.id === selfId ? 'me' : '' }, [swatch, `${p.name} — ${p.points}`, ...where]);
    }),
  );
}

export function addChat(name, text, color) {
  const who = el('span', { className: 'who', textContent: name });
  if (color) who.style.color = color;
  const log = $('chat-log');
  log.append(el('li', {}, [who, text]));
  while (log.children.length > 50) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

export function setConnectTarget(avatar, alreadyConnected) {
  const btn = $('connect-btn');
  if (!avatar) {
    btn.disabled = true;
    btn.textContent = '🤝 Nobody nearby';
  } else if (alreadyConnected) {
    btn.disabled = true;
    btn.textContent = `✅ Connected with ${avatar.player.name}`;
  } else {
    btn.disabled = false;
    btn.textContent = `🤝 Connect with ${avatar.player.name}`;
  }
}
