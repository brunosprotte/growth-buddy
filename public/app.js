// Estado
let mentorados = [];
let reguas = [];
let activeReguaId = null;
let newReguaFormOpen = false;

// Helpers
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

const fetchJSON = async (url, opts = {}) => {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
};

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const formatDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
};

const reguaAtiva = () => reguas.find(r => r.id === activeReguaId) || reguas[0];

// View switching
$$('nav a').forEach(a => {
  a.onclick = (e) => {
    e.preventDefault();
    $$('nav a').forEach(x => { x.classList.remove('active'); x.removeAttribute('aria-current'); });
    a.classList.add('active');
    a.setAttribute('aria-current', 'page');
    const view = a.dataset.view;
    $$('.view').forEach(v => v.hidden = v.id !== `view-${view}`);
    window.scrollTo(0, 0);
  };
});
// Default-current on first nav link
$('nav a.active')?.setAttribute('aria-current', 'page');

// --- Carregamento ---
const carregar = async () => {
  try {
    [mentorados, reguas] = await Promise.all([
      fetchJSON('/api/mentorados'),
      fetchJSON('/api/reguas'),
    ]);
    if (!activeReguaId && reguas.length) activeReguaId = reguas[0].id;
    renderAll();
  } catch (e) {
    console.error(e);
  }
};

const renderAll = () => {
  renderDashboard();
  renderMentorados();
  renderRegua();
  popularSelectRegua();
};

// Targeted re-fetches after mutations to avoid a full reload flicker
const recarregarMentorados = async () => {
  mentorados = await fetchJSON('/api/mentorados');
  renderDashboard();
  renderMentorados();
};

const recarregarReguas = async () => {
  reguas = await fetchJSON('/api/reguas');
  if (activeReguaId && !reguas.find(r => r.id === activeReguaId)) {
    activeReguaId = reguas[0]?.id;
  }
  renderDashboard();
  renderRegua();
  popularSelectRegua();
};

// --- Dashboard ---
const renderDashboard = () => {
  const total = mentorados.length;
  const ativos = mentorados.filter(m => m.status === 'ativo').length;
  const marcados = mentorados.reduce((s, m) => {
    const regua = reguas.find(r => r.id === m.reguaId);
    const nivel = regua?.niveis.find(n => n.id === m.nivelId);
    return s + (nivel ? nivel.itens.filter(i => m.proficiencias?.[i.id]).length : 0);
  }, 0);

  $('#stats').innerHTML = `
    <div class="stat">
      <div class="label">Mentorados</div>
      <div class="value">${total}</div>
      <div class="hint">${ativos} ativos</div>
    </div>
    <div class="stat">
      <div class="label">Marcos no nível</div>
      <div class="value">${marcados}</div>
      <div class="hint">concluídos no nível atual de cada mentorado</div>
    </div>
    <div class="stat">
      <div class="label">Réguas ativas</div>
      <div class="value">${reguas.length}</div>
      <div class="hint">${reguas.reduce((s, r) => s + r.niveis.reduce((a, n) => a + n.itens.length, 0), 0)} marcos no total</div>
    </div>
  `;

  const tbody = $('#tabela-dashboard tbody');
  const vazio = $('#vazio-dashboard');

  if (!total) {
    tbody.innerHTML = '';
    vazio.hidden = false;
    return;
  }
  vazio.hidden = true;

  tbody.innerHTML = mentorados.map(m => {
    const regua = reguas.find(r => r.id === m.reguaId);
    const nivel = regua?.niveis.find(n => n.id === m.nivelId);
    const totalItens = nivel?.itens.length ?? 0;
    const marcadosNoNivel = nivel
      ? nivel.itens.filter(i => m.proficiencias?.[i.id]).length
      : 0;
    const pct = totalItens ? Math.round((marcadosNoNivel / totalItens) * 100) : 0;

    return `
      <tr>
        <td>
          <strong>${escape(m.nome)}</strong>
          ${m.objetivo ? `<div style="color:var(--ink-mute);font-size:0.78rem">${escape(m.objetivo)}</div>` : ''}
          ${m.criadoEm ? `<div style="color:var(--ink-faint);font-size:0.78rem">desde ${formatDate(m.criadoEm)}</div>` : ''}
        </td>
        <td>
          ${regua ? `<span class="regua-tag">${escape(regua.nome)}</span>` : ''}
          ${nivel ? `<span class="nivel-badge ${nivel.id}">${escape(nivel.nome)}</span>` : ''}
        </td>
        <td>
          <div class="progress-cell">
            <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Progresso de ${escape(m.nome)} no nível ${escape(nivel?.nome || '')}"><div class="progress-fill" style="--pct:${pct / 100}"></div></div>
            <div class="progress-text">${marcadosNoNivel} de ${totalItens} marcos no nível</div>
          </div>
        </td>
        <td><span class="status-tag ${m.status}">${m.status}</span></td>
      </tr>
    `;
  }).join('');
};

// --- Mentorados ---
const popularSelectRegua = () => {
  const sel = $('#select-regua-form');
  if (!sel) return;
  sel.innerHTML = reguas.map(r => `<option value="${r.id}">${escape(r.nome)}</option>`).join('');
  popularSelectNivel();
};

const popularSelectNivel = () => {
  const sel = $('#select-nivel-form');
  if (!sel) return;
  const reguaId = $('#select-regua-form')?.value;
  const r = reguas.find(x => x.id === reguaId) || reguas[0];
  sel.innerHTML = (r?.niveis ?? []).map(n => `<option value="${n.id}">${escape(n.nome)}</option>`).join('');
};

$('#select-regua-form')?.addEventListener('change', popularSelectNivel);

const renderMentorados = () => {
  const lista = $('#lista-mentorados');
  if (!mentorados.length) {
    lista.innerHTML = '<p class="vazio">Nenhum mentorado ainda. Use o formulário acima.</p>';
    return;
  }

  lista.innerHTML = mentorados.map(m => {
    const regua = reguas.find(r => r.id === m.reguaId);
    if (!regua) return '';
    const niveisHtml = regua.niveis.map(n => {
      const itensHtml = (n.itens.length ? n.itens : []).map(item => {
        const profId = m.proficiencias?.[item.id] || '';
        const profNome = item.descricao ? `<span class="item-desc">${escape(item.descricao)}</span>` : '';
        const optsHtml = [`<option value="">— sem marcação —</option>`]
          .concat(regua.proficiencias.map(p =>
            `<option value="${p.id}" ${profId === p.id ? 'selected' : ''}>${escape(p.nome)}</option>`
          ))
          .join('');
        return `
          <div class="item-row">
            <div class="item-info">
              <span class="item-nome">${escape(item.nome)}</span>
              ${profNome}
            </div>
            <select class="prof-select" data-prof="${m.id}|${item.id}" aria-label="Proficiência de ${escape(item.nome)} para ${escape(m.nome)}">
              ${optsHtml}
            </select>
          </div>
        `;
      }).join('');
      return `
        <div class="nivel-section">
          <div class="nivel-titulo">
            <span class="nivel-badge ${n.id}">${escape(n.nome)}</span>
            <span style="font-weight:400;color:var(--ink-mute);font-size:0.78rem">${n.itens.length} marcos</span>
          </div>
          ${itensHtml || '<p class="vazio" style="padding:0.5rem">Sem marcos neste nível.</p>'}
        </div>
      `;
    }).join('');

    return `
      <div class="card-row">
        <div>
          <h4>${escape(m.nome)}</h4>
          <div class="meta">
            <span class="regua-tag">${escape(regua.nome)}</span>
            <span class="status-tag ${m.status}">${m.status}</span>
            ${m.objetivo ? ` · ${escape(m.objetivo)}` : ''}
            ${m.criadoEm ? ` · desde ${formatDate(m.criadoEm)}` : ''}
          </div>
          ${niveisHtml}
          ${m.notas ? `<div class="notas">${escape(m.notas)}</div>` : ''}
          <form class="edit-form" data-edit-form="${m.id}" hidden>
            <div class="form-grid">
              <label>Nome
                <input name="nome" value="${escape(m.nome)}" required maxlength="80">
              </label>
              <label>Objetivo
                <input name="objetivo" value="${escape(m.objetivo || '')}" maxlength="200" placeholder="ex: virar pleno backend">
              </label>
              <label>Régua
                <select name="reguaId" data-edit-regua="${escape(m.id)}">
                  ${reguas.map(r => `<option value="${r.id}" ${r.id === m.reguaId ? 'selected' : ''}>${escape(r.nome)}</option>`).join('')}
                </select>
              </label>
              <label>Nível
                <select name="nivelId" data-edit-nivel="${escape(m.id)}">
                  ${regua.niveis.map(n => `<option value="${n.id}" ${n.id === m.nivelId ? 'selected' : ''}>${escape(n.nome)}</option>`).join('')}
                </select>
              </label>
            </div>
            <label>Notas
              <textarea name="notas" maxlength="500">${escape(m.notas || '')}</textarea>
            </label>
            <div class="acoes">
              <button type="submit">Salvar</button>
              <button type="button" class="ghost" data-cancel-edit="${escape(m.id)}">Cancelar</button>
            </div>
          </form>
        </div>
        <div class="acoes">
          <select data-status="${m.id}" aria-label="Status de ${escape(m.nome)}">
            <option value="ativo" ${m.status === 'ativo' ? 'selected' : ''}>ativo</option>
            <option value="pausado" ${m.status === 'pausado' ? 'selected' : ''}>pausado</option>
            <option value="concluido" ${m.status === 'concluido' ? 'selected' : ''}>concluído</option>
          </select>
          <button class="ghost small" data-editar="${m.id}">editar</button>
          <button class="danger small" data-remover="${m.id}">remover</button>
        </div>
      </div>
    `;
  }).join('');

  // Cascade: editing regua updates its nivel options
  $$('[data-edit-regua]').forEach(sel => {
    sel.onchange = () => {
      const id = sel.dataset.editRegua;
      const r = reguas.find(x => x.id === sel.value);
      const nivelSel = document.querySelector(`[data-edit-nivel="${id}"]`);
      if (!r || !nivelSel) return;
      nivelSel.innerHTML = r.niveis.map(n => `<option value="${n.id}">${escape(n.nome)}</option>`).join('');
    };
  });

  $$('[data-edit-form]').forEach(form => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const id = form.dataset.editForm;
      const data = Object.fromEntries(new FormData(form));
      await fetchJSON(`/api/mentorados/${id}`, { method: 'PUT', body: data });
      await recarregarMentorados();
    };
  });

  $$('[data-cancel-edit]').forEach(b => {
    b.onclick = () => {
      const form = document.querySelector(`[data-edit-form="${b.dataset.cancelEdit}"]`);
      if (form) form.hidden = true;
    };
  });

  $$('.prof-select').forEach(s => {
    s.onchange = () => {
      const [id, itemId] = s.dataset.prof.split('|');
      const m = mentorados.find(x => x.id === id);
      const novo = { ...(m.proficiencias || {}) };
      if (s.value) novo[itemId] = s.value;
      else delete novo[itemId];
      atualizarMentorado(id, { proficiencias: novo });
    };
  });
  $$('[data-status]').forEach(s => {
    s.onchange = () => atualizarMentorado(s.dataset.status, { status: s.value });
  });
  $$('[data-editar]').forEach(b => {
    b.onclick = () => editarMentorado(b.dataset.editar);
  });
  $$('[data-remover]').forEach(b => {
    b.onclick = () => removerMentorado(b.dataset.remover);
  });
};

$('#form-mentorado').onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  await fetchJSON('/api/mentorados', { method: 'POST', body: data });
  e.target.reset();
  await recarregarMentorados();
};

const atualizarMentorado = async (id, patch) => {
  // optimistic: update local state, then PUT, rollback on error
  const idx = mentorados.findIndex(m => m.id === id);
  const snapshot = idx >= 0 ? { ...mentorados[idx] } : null;
  if (snapshot) Object.assign(mentorados[idx], patch);
  renderDashboard();
  renderMentorados();
  try {
    await fetchJSON(`/api/mentorados/${id}`, { method: 'PUT', body: patch });
  } catch (err) {
    if (snapshot) mentorados[idx] = snapshot;
    renderDashboard();
    renderMentorados();
    alert(err.message);
  }
};

const editarMentorado = async (id) => {
  const form = document.querySelector(`[data-edit-form="${id}"]`);
  if (!form) return;
  const willOpen = form.hidden;
  document.querySelectorAll('[data-edit-form]').forEach(f => f.hidden = true);
  form.hidden = !willOpen;
  if (willOpen) form.querySelector('input[name="nome"]')?.focus();
};

const removerMentorado = async (id) => {
  if (!confirm('Remover este mentorado?')) return;
  await fetchJSON(`/api/mentorados/${id}`, { method: 'DELETE' });
  await recarregarMentorados();
};

// --- Réguas ---
const renderRegua = () => {
  const tabs = $('#regua-tabs');
  tabs.innerHTML = reguas.map(r => `
    <button class="regua-tab ${r.id === activeReguaId ? 'active' : ''}" data-tab="${r.id}">${escape(r.nome)}</button>
  `).join('') + `<button class="regua-tab add" data-add-regua>+ Nova régua</button>`;

  tabs.querySelectorAll('[data-tab]').forEach(b => {
    b.onclick = () => { activeReguaId = b.dataset.tab; renderRegua(); };
  });
  tabs.querySelector('[data-add-regua]').onclick = () => {
    newReguaFormOpen = !newReguaFormOpen;
    renderRegua();
    if (newReguaFormOpen) {
      const f = $('#regua-detail [data-new-regua-form]');
      f?.querySelector('input[name="nome"]')?.focus();
    }
  };

  const r = reguaAtiva();
  if (!r) {
    $('#regua-detail').innerHTML = '<p class="vazio">Crie sua primeira régua técnica.</p>';
    return;
  }

  $('#regua-detail').innerHTML = `
    <form class="panel new-regua-form" data-new-regua-form ${newReguaFormOpen ? '' : 'hidden'}>
      <h3>Nova régua</h3>
      <div class="form-grid">
        <label>Nome
          <input name="nome" required maxlength="80" placeholder="ex: Backend, Frontend, QA">
        </label>
        <label>Descrição (opcional)
          <input name="descricao" maxlength="300" placeholder="Desenvolvedor backend Node + Postgres">
        </label>
      </div>
      <div class="acoes">
        <button type="submit">Criar régua</button>
        <button type="button" class="ghost" data-cancel-new-regua>Cancelar</button>
      </div>
    </form>

    <div class="regua-detail-header">
      <div class="texto">
        <h3>${escape(r.nome)}</h3>
        <p>${escape(r.descricao || 'Sem descrição.')}</p>
      </div>
      <div class="acoes">
        <button class="ghost small" data-edit-regua>renomear</button>
        <button class="danger small" data-del-regua>remover</button>
      </div>
    </div>

    <div class="profs-section">
      <h4>Níveis de proficiência</h4>
      <div class="profs-list">
        ${r.proficiencias.map(p => `
          <span class="prof-pill">
            <span class="prof-ordem">${p.ordem}</span>
            ${escape(p.nome)}
            <button class="ghost mini" data-edit-prof="${p.id}">editar</button>
            <button class="danger mini" data-del-prof="${p.id}">×</button>
          </span>
        `).join('') || '<span style="color:var(--ink-mute);font-size:0.85rem">Nenhum nível definido.</span>'}
      </div>
      <div class="add-prof">
        <input placeholder="Novo nível (ex: Conhecimento sólido)" data-add-prof maxlength="120">
        <button data-add-prof-btn>Adicionar</button>
      </div>
    </div>

    <div class="niveis-grid">
      ${r.niveis.map(n => `
        <div class="nivel-panel ${n.id}">
          <header>
            <h3>
              ${escape(n.nome)}
              <span class="acoes">
                <button class="ghost mini" data-edit-nivel="${n.id}" data-nome-nivel="${escape(n.nome)}">editar</button>
                <button class="danger mini" data-del-nivel="${n.id}">×</button>
              </span>
            </h3>
            <p>${n.itens.length} marcos</p>
          </header>
          <ul>
            ${(n.itens.length ? n.itens.map(i => `
              <li>
                <div class="linha-topo">
                  <span>${escape(i.nome)}</span>
                  <span class="acoes">
                    <button class="ghost small" data-edit-item="${n.id}|${i.id}" data-nome="${escape(i.nome)}" data-desc="${escape(i.descricao)}">editar</button>
                    <button class="danger small" data-del-item="${n.id}|${i.id}">remover</button>
                  </span>
                </div>
                ${i.descricao ? `<span class="item-desc">${escape(i.descricao)}</span>` : ''}
              </li>
            `).join('') : '<li><span style="color:var(--ink-mute);font-style:italic">Sem marcos.</span></li>')}
          </ul>
          <div class="add-item">
            <input placeholder="Nome do marco" data-add-nome="${n.id}" maxlength="120">
            <textarea placeholder="Descrição (opcional)" data-add-desc="${n.id}" maxlength="300"></textarea>
            <div class="linha">
              <button data-add-item-btn="${n.id}">Adicionar marco</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="add-nivel">
      <input placeholder="Novo nível (ex: Tech Lead)" data-add-nivel maxlength="80">
      <button data-add-nivel-btn>Adicionar nível</button>
    </div>
  `;

  $('#regua-detail [data-edit-regua]').onclick = () => editarRegua(r.id);
  $('#regua-detail [data-del-regua]').onclick = () => removerRegua(r.id);

  const newReguaForm = $('#regua-detail [data-new-regua-form]');
  if (newReguaForm) {
    newReguaForm.onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(newReguaForm));
      const created = await fetchJSON('/api/reguas', { method: 'POST', body: data });
      newReguaFormOpen = false;
      activeReguaId = created.id;
      await recarregarReguas();
    };
  }
  $('#regua-detail [data-cancel-new-regua]')?.addEventListener('click', () => {
    newReguaFormOpen = false;
    renderRegua();
  });

  $$('#regua-detail [data-edit-prof]').forEach(b => {
    b.onclick = () => editarProf(r.id, b.dataset.editProf);
  });
  $$('#regua-detail [data-del-prof]').forEach(b => {
    b.onclick = () => removerProf(r.id, b.dataset.delProf);
  });
  $('#regua-detail [data-add-prof-btn]').onclick = () => addProf(r.id);
  $('#regua-detail [data-add-prof]').addEventListener('keydown', e => {
    if (e.key === 'Enter') addProf(r.id);
  });

  $$('#regua-detail [data-edit-nivel]').forEach(b => {
    b.onclick = () => editarNivel(r.id, b.dataset.editNivel, b.dataset.nomeNivel);
  });
  $$('#regua-detail [data-del-nivel]').forEach(b => {
    b.onclick = () => removerNivel(r.id, b.dataset.delNivel);
  });

  $$('#regua-detail [data-edit-item]').forEach(b => {
    b.onclick = () => editarItem(r.id, b.dataset.editItem, b.dataset.nome, b.dataset.desc);
  });
  $$('#regua-detail [data-del-item]').forEach(b => {
    b.onclick = () => removerItem(r.id, b.dataset.delItem);
  });
  $$('#regua-detail [data-add-item-btn]').forEach(b => {
    b.onclick = () => addItem(r.id, b.dataset.addItemBtn);
  });
  $$('#regua-detail [data-add-nome]').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') addItem(r.id, input.dataset.addNome);
    });
  });

  $('#regua-detail [data-add-nivel-btn]').onclick = () => addNivel(r.id);
  $('#regua-detail [data-add-nivel]').addEventListener('keydown', e => {
    if (e.key === 'Enter') addNivel(r.id);
  });
};

const criarRegua = async () => {}; // deprecated: inline form now lives in renderRegua()

const editarRegua = async (id) => {
  const r = reguas.find(x => x.id === id);
  if (!r) return;
  const nome = prompt('Nome:', r.nome);
  if (nome === null) return;
  const descricao = prompt('Descrição:', r.descricao || '');
  if (descricao === null) return;
  await fetchJSON(`/api/reguas/${id}`, { method: 'PUT', body: { nome, descricao } });
  await recarregarReguas();
};

const removerRegua = async (id) => {
  const r = reguas.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`Remover a régua "${r.nome}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await fetchJSON(`/api/reguas/${id}`, { method: 'DELETE' });
    await recarregarReguas();
  } catch (e) {
    alert(e.message);
  }
};

const addProf = async (reguaId) => {
  const input = $('#regua-detail [data-add-prof]');
  const nome = input.value.trim();
  if (!nome) return;
  await fetchJSON(`/api/reguas/${reguaId}/proficiencias`, { method: 'POST', body: { nome } });
  await recarregarReguas();
};

const editarProf = async (reguaId, profId) => {
  const r = reguas.find(x => x.id === reguaId);
  const p = r?.proficiencias.find(x => x.id === profId);
  if (!p) return;
  const nome = prompt('Nome do nível de proficiência:', p.nome);
  if (nome === null || !nome.trim()) return;
  await fetchJSON(`/api/reguas/${reguaId}/proficiencias/${profId}`, { method: 'PUT', body: { nome } });
  await recarregarReguas();
};

const removerProf = async (reguaId, profId) => {
  if (!confirm('Remover este nível de proficiência? Será desmarcado dos mentorados.')) return;
  await fetchJSON(`/api/reguas/${reguaId}/proficiencias/${profId}`, { method: 'DELETE' });
  await recarregarReguas();
};

const addNivel = async (reguaId) => {
  const input = $('#regua-detail [data-add-nivel]');
  const nome = input.value.trim();
  if (!nome) return;
  await fetchJSON(`/api/reguas/${reguaId}/niveis`, { method: 'POST', body: { nome } });
  await recarregarReguas();
};

const editarNivel = async (reguaId, nivelId, nomeAtual) => {
  const nome = prompt('Novo nome do nível:', nomeAtual);
  if (nome === null || !nome.trim()) return;
  await fetchJSON(`/api/reguas/${reguaId}/niveis/${nivelId}`, { method: 'PUT', body: { nome } });
  await recarregarReguas();
};

const removerNivel = async (reguaId, nivelId) => {
  if (!confirm('Remover este nível? Só é possível se não houver marcos nele.')) return;
  try {
    await fetchJSON(`/api/reguas/${reguaId}/niveis/${nivelId}`, { method: 'DELETE' });
    await recarregarReguas();
  } catch (e) {
    alert(e.message);
  }
};

const addItem = async (reguaId, nivelId) => {
  const nomeInput = $(`#regua-detail [data-add-nome="${nivelId}"]`);
  const descInput = $(`#regua-detail [data-add-desc="${nivelId}"]`);
  const nome = nomeInput.value.trim();
  const descricao = descInput.value.trim();
  if (!nome) return;
  await fetchJSON(`/api/reguas/${reguaId}/niveis/${nivelId}/itens`, {
    method: 'POST',
    body: { nome, descricao },
  });
  await recarregarReguas();
};

const editarItem = async (reguaId, key, nomeAtual, descAtual) => {
  const [nivelId, itemId] = key.split('|');
  const nome = prompt('Nome do marco:', nomeAtual);
  if (nome === null || !nome.trim()) return;
  const descricao = prompt('Descrição (opcional):', descAtual || '');
  if (descricao === null) return;
  await fetchJSON(`/api/reguas/${reguaId}/niveis/${nivelId}/itens/${itemId}`, {
    method: 'PUT',
    body: { nome, descricao },
  });
  await recarregarReguas();
};

const removerItem = async (reguaId, key) => {
  const [nivelId, itemId] = key.split('|');
  if (!confirm('Remover este marco? Também será desmarcado dos mentorados.')) return;
  await fetchJSON(`/api/reguas/${reguaId}/niveis/${nivelId}/itens/${itemId}`, { method: 'DELETE' });
  await recarregarReguas();
};

carregar();