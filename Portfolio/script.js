/* =========================================================
   Victor Paula — Portfolio
   Terminal interactions: boot sequence, tab navigation,
   live GitHub repo fetch, and a small command interpreter.
   ========================================================= */

const GITHUB_USER = 'VCTRPL';
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded', () => {
  runBootSequence();
  startClock();
  setupTabNav();
  loadRepos();
  setupShell();
});

/* ---------------------------------------------------------
   Boot sequence
--------------------------------------------------------- */
function runBootSequence() {
  const screen = document.getElementById('boot-screen');
  const linesEl = document.getElementById('boot-lines');
  if (!screen || !linesEl) return;

  if (prefersReducedMotion) {
    screen.classList.add('is-hidden');
    return;
  }

  const lines = [
    { text: 'iniciando sessão...', cls: '' },
    { text: 'carregando victor@portfolio...', cls: '' },
    { text: 'montando /sobre /skills /projetos /contato... ', cls: 'ok', suffix: 'ok' },
    { text: 'conectando a github.com/VCTRPL... ', cls: 'ok', suffix: 'ok' },
    { text: 'pronto.', cls: 'warn' },
  ];

  let i = 0;
  const step = () => {
    if (i >= lines.length) {
      setTimeout(() => screen.classList.add('is-hidden'), 350);
      return;
    }
    const { text, cls, suffix } = lines[i];
    const p = document.createElement('p');
    p.className = 'boot-line';
    p.textContent = text;
    if (suffix) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = suffix;
      p.appendChild(span);
    }
    linesEl.appendChild(p);
    i += 1;
    setTimeout(step, 260);
  };
  step();

  // Allow skipping the boot animation.
  screen.addEventListener('click', () => screen.classList.add('is-hidden'));
  window.addEventListener('keydown', function skip(e) {
    if (e.key === 'Enter' || e.key === 'Escape') {
      screen.classList.add('is-hidden');
      window.removeEventListener('keydown', skip);
    }
  });
}

/* ---------------------------------------------------------
   Clock (cosmetic, matches the titlebar of an editor)
--------------------------------------------------------- */
function startClock() {
  const clock = document.getElementById('clock');
  if (!clock) return;
  const update = () => {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString('pt-BR', { hour12: false });
  };
  update();
  setInterval(update, 1000);
}

/* ---------------------------------------------------------
   Tab navigation — smooth scroll + active state on scroll
--------------------------------------------------------- */
function setupTabNav() {
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const sections = tabs
    .map((tab) => document.getElementById(tab.dataset.target))
    .filter(Boolean);

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = document.getElementById(tab.dataset.target);
      if (target) {
        target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
      }
    });
  });

  if (!('IntersectionObserver' in window) || sections.length === 0) return;

  // O scroll acontece em lugares diferentes dependendo do modo:
  // - modo "mesa 3D" (.window.is-embedded): quem rola é #terminal-body
  //   internamente, não a página.
  // - modo normal/tela cheia: quem rola é a própria página (viewport).
  // Usar sempre o viewport como "root" (padrão) faz o destaque da aba
  // ficar errado no modo mesa 3D. Por isso recriamos o observer com o
  // root correto sempre que o modo mudar (classe is-embedded alterna
  // via three-scene.js).
  const windowEl = document.getElementById('main-window');
  const terminalBody = document.querySelector('.terminal-body');
  let observer = null;

  function createTabObserver() {
    if (observer) observer.disconnect();
    const embedded = windowEl?.classList.contains('is-embedded');
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.target === entry.target.id));
          }
        });
      },
      { root: embedded ? terminalBody : null, rootMargin: '-40% 0px -50% 0px', threshold: 0 }
    );
    sections.forEach((section) => observer.observe(section));
  }

  createTabObserver();

  if (windowEl) {
    new MutationObserver(createTabObserver).observe(windowEl, { attributes: true, attributeFilter: ['class'] });
  }
}

/* ---------------------------------------------------------
   Live GitHub repositories
--------------------------------------------------------- */
async function loadRepos() {
  const statusEl = document.getElementById('repo-status');
  const listEl = document.getElementById('repo-list');
  if (!statusEl || !listEl) return;

  try {
    const res = await fetch(
      `https://api.github.com/users/${GITHUB_USER}/repos?sort=updated&per_page=6`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );

    if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);

    const repos = await res.json();
    const visible = repos.filter((r) => !r.fork).slice(0, 6);

    if (visible.length === 0) {
      statusEl.textContent = 'nenhum repositório público encontrado no momento.';
      return;
    }

    statusEl.textContent = `${visible.length} repositório(s) carregado(s) — atualizados via API.`;
    listEl.innerHTML = '';

    visible.forEach((repo) => {
      const li = document.createElement('li');
      li.className = 'repo-card';

      const updated = new Date(repo.pushed_at).toLocaleDateString('pt-BR');

      li.innerHTML = `
        <div class="repo-card-top">
          <a class="repo-name" href="${repo.html_url}" target="_blank" rel="noopener noreferrer">${escapeHTML(repo.name)}</a>
          ${repo.language ? `<span class="repo-lang">${escapeHTML(repo.language)}</span>` : ''}
        </div>
        ${repo.description ? `<p class="repo-desc">${escapeHTML(repo.description)}</p>` : ''}
        <div class="repo-meta">
          <span>★ ${repo.stargazers_count}</span>
          <span>atualizado em ${updated}</span>
          ${repo.private ? '<span>privado</span>' : ''}
        </div>
      `;
      listEl.appendChild(li);
    });
  } catch (err) {
    statusEl.classList.add('is-error');
    statusEl.textContent = 'não foi possível carregar os repositórios agora (limite de requisições da API do GitHub). Veja diretamente no link abaixo.';
  }
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------------------------------------------------
   Interactive shell
--------------------------------------------------------- */
function setupShell() {
  const input = document.getElementById('shell-input');
  const log = document.getElementById('shell-log');
  if (!input || !log) return;

  const history = [];
  let historyIndex = -1;

  const commands = {
    help: () => [
      'comandos disponíveis:',
      '  whoami      — nome e função atual',
      '  sobre       — resumo pessoal',
      '  skills      — tecnologias e nível',
      '  idiomas     — idiomas falados',
      '  projetos    — link para os repositórios',
      '  contato     — formas de contato',
      '  pdf         — abre o portfólio em PDF',
      '  banner      — reimprime o banner inicial',
      '  clear       — limpa esta tela',
    ].join('\n'),

    whoami: () => [
      'Victor Paula — Software Engineering Student',
      'Desenvolvedor focado em criar soluções digitais modernas, funcionais',
      'e com boa experiência de usuário.',
    ].join('\n'),

    sobre: () => [
      '18 anos · Engenharia de Software, PUC Minas (2º período).',
      'Sem experiência profissional prévia — aprendendo construindo.',
    ].join('\n'),

    skills: () => [
      'HTML........... breve domínio',
      'CSS............ breve domínio',
      'JavaScript..... base rasa',
      'Python......... conhecimento inicial (1º período)',
      'Java........... estudando agora',
      'Git / GitHub... uso no dia a dia',
      'VS Code........ editor principal',
    ].join('\n'),

    idiomas: () => [
      'Português...... nativo',
      'Inglês......... fluente (diploma Cambridge, HC School — Betim, MG)',
      'Espanhol....... básico',
    ].join('\n'),

    projetos: () => {
      scrollToSection('projetos');
      return 'abrindo projetos.sh — veja também github.com/VCTRPL';
    },

    contato: () => {
      scrollToSection('contato');
      return [
        'github....: https://github.com/VCTRPL',
        'linkedin..: https://www.linkedin.com/in/victor-paula-3b6a603b3/',
        'email.....: victorrsdp@gmail.com',
        'whatsapp..: (31) 99777-7135',
      ].join('\n');
    },

    pdf: () => {
      window.open('Victor-Paula-Portfolio.pdf', '_blank', 'noopener,noreferrer');
      return 'abrindo Victor-Paula-Portfolio.pdf em uma nova aba...';
    },

    curriculo: () => commands.pdf(),

    banner: () => printBanner(log),

    clear: () => {
      log.innerHTML = '';
      return null;
    },

    sudo: () => 'permissão negada: victor não está no arquivo sudoers. (mas um e-mail educado costuma funcionar)',

    ls: () => 'sobre.md  skills.json  projetos.sh  contato.sh',
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const raw = input.value.trim();
      input.value = '';
      if (!raw) return;

      history.push(raw);
      historyIndex = history.length;

      printCommand(log, raw);

      const [cmdName, ...rest] = raw.toLowerCase().split(/\s+/);
      const handler = commands[cmdName];

      let output;
      if (handler) {
        output = handler(rest);
      } else {
        output = `comando não encontrado: ${escapeHTML(cmdName)}. digite "help" para ver os comandos disponíveis.`;
        printOutput(log, output, 'err');
        log.scrollTop = log.scrollHeight;
        return;
      }

      if (output) printOutput(log, output, cmdName === 'sudo' ? 'warn' : 'ok');
      log.scrollTop = log.scrollHeight;
    } else if (e.key === 'ArrowUp') {
      if (history.length === 0) return;
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex] || '';
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      if (history.length === 0) return;
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] || '';
      e.preventDefault();
    }
  });

  // Focus the shell when clicking anywhere inside it.
  document.getElementById('shell').addEventListener('click', () => input.focus());

  printOutput(log, 'sessão iniciada. digite "help" para começar.', 'ok');
}

function printCommand(log, text) {
  const p = document.createElement('p');
  p.className = 'log-cmd';
  p.innerHTML = `<span class="prompt-user">victor</span><span class="prompt-at">@</span><span class="prompt-host">portfolio</span><span class="prompt-sep">:</span><span class="prompt-path">~</span><span class="prompt-dollar">$</span> <span class="prompt-cmd">${escapeHTML(text)}</span>`;
  log.appendChild(p);
}

function printOutput(log, text, tone) {
  const p = document.createElement('p');
  p.className = `log-output ${tone || ''}`.trim();
  p.textContent = text;
  log.appendChild(p);
}

function printBanner(log) {
  return [
    ' __     _____ ____ _____ ___  ____  ',
    ' \\ \\   / /_ _/ ___|_   _/ _ \\|  _ \\ ',
    '  \\ \\ / / | | |     | || | | | |_) |',
    '   \\ V /  | | |___  | || |_| |  _ < ',
    '    \\_/  |___\\____| |_| \\___/|_| \\_\\',
    '',
    'Victor Paula — Software Engineering Student',
  ].join('\n');
}

function scrollToSection(id) {
  const target = document.getElementById(id);
  if (target) target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
}

/* =========================================================
   Cursor customizado da "tela" — só aparece sobre #main-window
   (o cursor nativo do SO fica escondido lá via CSS: `cursor:none`).
   Puramente visual: o elemento é pointer-events:none, então nunca
   intercepta cliques — toda a interação com abas, links e o shell
   continua funcionando de forma 100% nativa.
   ========================================================= */
(function initCustomCursor() {
  const cursorEl = document.getElementById('custom-cursor');
  const screenEl = document.getElementById('main-window');
  if (!cursorEl || !screenEl || window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

  function move(e) {
    cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  }
  function show() { cursorEl.classList.add('is-visible'); }
  function hide() { cursorEl.classList.remove('is-visible'); }
  function activate() { cursorEl.classList.add('is-active'); }
  function deactivate() { cursorEl.classList.remove('is-active'); }

  screenEl.addEventListener('mouseenter', show);
  screenEl.addEventListener('mouseleave', hide);
  window.addEventListener('mousemove', move);

  // Encolhe um pouco o cursor sobre elementos clicáveis (feedback visual extra)
  screenEl.addEventListener('mouseover', (e) => {
    if (e.target.closest('a, button, .tab, [role="button"]')) activate();
  });
  screenEl.addEventListener('mouseout', (e) => {
    if (e.target.closest('a, button, .tab, [role="button"]')) deactivate();
  });
})();
