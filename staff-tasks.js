/* Quadro exclusivo do painel técnico LabInfo. Nenhuma operação altera chamados. */
(() => {
  const statuses = {todo:'A fazer',doing:'Fazendo',done:'Concluído'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const filterTasks = (rows,query,assignee) => rows.filter(t => (!assignee || t.assignee_id===assignee) &&
    `${t.title} ${t.description}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(String(query||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()));
  let profile=null,section=null,dialog=null,rows=[],labs=[],people=[],ticketNames=new Map(),busy=false,editing=null,dragged=null,loading=false,searchGeneration=0,loadGeneration=0;
  const db=()=>window.labinfoDb;
  const $=s=>section.querySelector(s);
  const notify=message=>window.toast?.(message);
  function mount(){
    if(section)return;
    section=document.createElement('section');section.id='staffTasksSection';section.className='admin-section tasks-section';section.hidden=true;
    section.innerHTML=`<div class="tasks-toolbar"><div><span class="eyebrow">ORGANIZAÇÃO DA EQUIPE</span><h2>Um passo de cada vez.</h2><p>Arraste os cartões ou escolha uma coluna para atualizar a atividade.</p></div><button id="newStaffTask" class="primary" type="button">＋ Nova tarefa</button></div>
      <div class="tasks-filters"><label class="tasks-search">Buscar tarefa<input id="taskQuery" type="search" placeholder="Título ou descrição…"></label><label>Responsável<select id="taskAssigneeFilter"><option value="">Toda a equipe</option></select></label><button id="refreshStaffTasks" class="secondary" type="button">↻ Atualizar</button><span id="tasksFeedback" role="status" aria-live="polite"></span></div>
      <div id="tasksBoard" class="tasks-board" aria-label="Quadro de tarefas"></div>`;
    document.querySelector('#adminView').append(section);
    $('#newStaffTask').insertAdjacentHTML('beforebegin','<button id="expandStaffTasks" class="secondary" type="button" hidden>Expandir ↗</button>');
    $('#expandStaffTasks').onclick=()=>window.labinfoOpenAdminRoute('tarefas',{push:true});
    dialog=document.createElement('dialog');dialog.id='staffTaskDialog';dialog.className='task-dialog';
    dialog.innerHTML=`<form id="staffTaskForm"><header><div><span class="eyebrow">TAREFA DA EQUIPE</span><h2 id="staffTaskDialogTitle">Nova tarefa</h2></div><button id="closeStaffTask" type="button" aria-label="Fechar tarefa">×</button></header>
      <label>Título<input name="title" required minlength="2" maxlength="160" placeholder="Ex.: Preparar laboratório para a próxima turma"></label>
      <label>Descrição<textarea name="description" rows="4" maxlength="5000" placeholder="O que precisa ser feito?"></textarea></label>
      <div class="task-form-row"><label>Coluna<select name="status">${Object.entries(statuses).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select></label><label>Técnico responsável<select name="assignee" required></select></label></div>
      <label>Laboratório <small>opcional</small><select name="lab"><option value="">Sem laboratório</option></select></label>
      <fieldset class="task-ticket-field"><legend>Chamado vinculado <small>opcional</small></legend><div><input id="taskTicketSearch" aria-label="Procurar chamado pelo protocolo" placeholder="Buscar protocolo, ex.: LAB-00058" maxlength="60"><button id="findTaskTicket" class="secondary" type="button">Buscar</button></div><select name="ticket" aria-label="Chamado vinculado"><option value="">Sem chamado</option></select><small id="taskTicketHint" role="status">O vínculo é apenas uma referência; não muda o chamado.</small></fieldset>
      <details id="taskHistory"><summary>Histórico da tarefa</summary><div id="taskHistoryList"></div></details>
      <div id="taskDeleteConfirmation" class="task-delete-confirmation" hidden><strong>Excluir esta tarefa do quadro?</strong><p>Ela deixará de aparecer nas colunas. O histórico será preservado.</p><button id="confirmDeleteStaffTask" class="danger-button" type="button">Sim, excluir tarefa</button><button id="keepStaffTask" class="secondary" type="button">Manter tarefa</button></div>
      <p id="taskFormError" class="error-text" role="alert"></p><footer><button id="deleteStaffTask" class="danger-button" type="button" hidden>Excluir tarefa</button><button id="cancelStaffTask" class="secondary" type="button">Voltar</button><button id="saveStaffTask" class="primary" type="submit">Salvar tarefa</button></footer></form>`;
    document.body.append(dialog);
    $('#newStaffTask').onclick=()=>openEditor();
    $('#refreshStaffTasks').onclick=()=>refresh();
    $('#taskQuery').oninput=render;$('#taskAssigneeFilter').onchange=render;
    const close=()=>{if(!busy){dialog.close();searchGeneration++}};
    dialog.querySelector('#closeStaffTask').onclick=close;dialog.querySelector('#cancelStaffTask').onclick=close;
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();else searchGeneration++});
    dialog.querySelector('#staffTaskForm').onsubmit=save;
    dialog.querySelector('#deleteStaffTask').onclick=()=>{dialog.querySelector('#taskDeleteConfirmation').hidden=false;dialog.querySelector('#confirmDeleteStaffTask').focus()};
    dialog.querySelector('#keepStaffTask').onclick=()=>{dialog.querySelector('#taskDeleteConfirmation').hidden=true};
    dialog.querySelector('#confirmDeleteStaffTask').onclick=remove;
    dialog.querySelector('#findTaskTicket').onclick=findTicket;
    dialog.querySelector('#taskTicketSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();findTicket()}};
    dialog.querySelector('#taskHistory').ontoggle=()=>{if(dialog.querySelector('#taskHistory').open)loadHistory()};
    setInterval(()=>{if(!document.hidden&&!section.hidden&&!section.closest('[hidden]')&&!document.querySelector('#adminView').hidden&&!dialog.open&&!busy)refresh(true)},60000);
    db()?.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){loadGeneration++;rows=[];profile=null;section.hidden=true;dialog.close();$('#tasksBoard').innerHTML=''}});
  }
  function errorText(error){
    if(error?.code==='PGRST202'&&String(error.message).includes('delete_staff_task'))return 'Para habilitar a exclusão, execute 20261113_staff_tasks_delete.sql no Supabase do LabInfo.';
    if(['42P01','PGRST205','PGRST202'].includes(error?.code))return 'Tarefas ainda não ativadas no banco. Execute a migração 20261113_staff_tasks.sql no Supabase do LabInfo.';
    return error?.message||'Não foi possível acessar as tarefas. Tente novamente.';
  }
  async function refresh(quiet=false){
    if(loading||busy||!profile)return;
    loading=true;const generation=++loadGeneration;
    $('#refreshStaffTasks').disabled=true;$('#tasksFeedback').textContent=quiet?'':'Carregando…';
    try{
      const all=[];
      for(let offset=0;;offset+=500){
        const result=await db().from('staff_tasks').select('*').order('created_at',{ascending:false}).order('id').range(offset,offset+499);
        if(result.error)throw result.error;all.push(...result.data);if(result.data.length<500)break;
      }
      const [labResult,peopleResult]=await Promise.all([
        db().from('labs').select('id,name,active').order('name'),
        db().from('profiles').select('id,full_name,active,role').order('full_name')
      ]);
      if(labResult.error||peopleResult.error)throw labResult.error||peopleResult.error;
      if(generation!==loadGeneration)return;
      rows=all.filter(t=>!t.deleted_at);labs=labResult.data||[];people=peopleResult.data||[];
      const selected=$('#taskAssigneeFilter').value;
      $('#taskAssigneeFilter').innerHTML='<option value="">Toda a equipe</option>'+people.filter(p=>p.role==='tecnico'||rows.some(t=>t.assignee_id===p.id)).map(p=>`<option value="${p.id}">${esc(p.full_name)}${p.active?'':' (inativo)'}</option>`).join('');
      $('#taskAssigneeFilter').value=selected;
      $('#tasksFeedback').textContent='Atualizado agora · sincronização a cada minuto';render();
    }catch(error){$('#tasksFeedback').textContent=errorText(error);}
    finally{loading=false;$('#refreshStaffTasks').disabled=false;}
  }
  function render(){
    const visible=filterTasks(rows,$('#taskQuery').value,$('#taskAssigneeFilter').value);
    $('#tasksBoard').innerHTML=Object.entries(statuses).map(([key,name])=>{
      const list=visible.filter(t=>t.status===key).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
      return `<section class="task-column task-column-${key}" data-task-column="${key}" aria-label="${name}"><header><span class="task-column-dot"></span><h3>${name}</h3><b>${list.length}</b><button class="task-add" data-add-status="${key}" type="button" aria-label="Adicionar tarefa em ${name}">＋</button></header><div class="task-column-cards">${list.map(card).join('')||'<p class="task-empty">Nenhuma tarefa por aqui.<br>Um espaço para o próximo passo.</p>'}</div></section>`;
    }).join('');
    $('#tasksBoard').querySelectorAll('[data-add-status]').forEach(b=>b.onclick=()=>openEditor(null,b.dataset.addStatus));
    $('#tasksBoard').querySelectorAll('[data-open-task]').forEach(b=>b.onclick=()=>openEditor(rows.find(t=>t.id===b.dataset.openTask)));
    $('#tasksBoard').querySelectorAll('[data-move-task]').forEach(select=>select.onchange=()=>move(rows.find(t=>t.id===select.dataset.moveTask),select.value));
    $('#tasksBoard').querySelectorAll('[data-task-card]').forEach(element=>{
      element.ondragstart=e=>{if(busy){e.preventDefault();return}dragged=element.dataset.taskCard;e.dataTransfer.setData('text/plain',dragged);e.dataTransfer.effectAllowed='move';element.classList.add('task-dragging')};
      element.ondragend=()=>{dragged=null;element.classList.remove('task-dragging');$('#tasksBoard').querySelectorAll('.task-drop-active').forEach(x=>x.classList.remove('task-drop-active'))};
    });
    $('#tasksBoard').querySelectorAll('[data-task-column]').forEach(column=>{
      column.ondragover=e=>{if(dragged&&!busy){e.preventDefault();e.dataTransfer.dropEffect='move';column.classList.add('task-drop-active')}};
      column.ondragleave=e=>{if(!column.contains(e.relatedTarget))column.classList.remove('task-drop-active')};
      column.ondrop=e=>{e.preventDefault();column.classList.remove('task-drop-active');const task=rows.find(t=>t.id===dragged);dragged=null;if(task)move(task,column.dataset.taskColumn)};
    });
  }
  function card(task){
    const person=people.find(p=>p.id===task.assignee_id),lab=labs.find(l=>l.id===task.lab_id);
    const initials=(person?.full_name||'?').split(/\s+/).slice(0,2).map(w=>w[0]).join('');
    return `<article class="task-card" draggable="${!busy}" data-task-card="${task.id}"><button class="task-card-open" type="button" data-open-task="${task.id}" aria-label="Abrir tarefa: ${esc(task.title)}">${lab?`<span class="task-lab">${esc(lab.name)}</span>`:''}<h4>${esc(task.title)}</h4>${task.description?`<p>${esc(task.description)}</p>`:''}${task.ticket_id?`<small class="task-linked">↗ ${esc(ticketNames.get(task.ticket_id)||'Chamado vinculado')}</small>`:''}</button><footer><span class="task-person" title="${esc(person?.full_name||'Técnico responsável')}"><i aria-hidden="true">${esc(initials)}</i><span>${esc(person?.full_name||'Técnico responsável')}</span></span><select data-move-task="${task.id}" aria-label="Mover tarefa ${esc(task.title)} para" ${busy?'disabled':''}>${Object.entries(statuses).map(([s,n])=>`<option value="${s}" ${s===task.status?'selected':''}>${n}</option>`).join('')}</select></footer></article>`;
  }
  async function move(task,status){
    if(!task||busy||status===task.status){render();return;}
    busy=true;render();$('#tasksFeedback').textContent='Salvando mudança…';
    try{
      const {error}=await db().rpc('move_staff_task',{p_id:task.id,p_status:status,p_version:task.version});
      if(error)throw error;notify(`Tarefa movida para ${statuses[status]}.`);
    }catch(error){notify(errorText(error));}
    finally{busy=false;await refresh();}
  }
  async function openEditor(task=null,status='todo'){
    if(busy||!profile)return;
    editing=task;searchGeneration++;
    const form=dialog.querySelector('form');form.reset();
    dialog.querySelector('#staffTaskDialogTitle').textContent=task?'Detalhes da tarefa':'Nova tarefa';
    form.elements.title.value=task?.title||'';form.elements.description.value=task?.description||'';form.elements.status.value=task?.status||status;
    form.elements.assignee.innerHTML=people.filter(p=>p.role==='tecnico'&&(p.active||p.id===task?.assignee_id)).map(p=>`<option value="${p.id}">${esc(p.full_name)}${p.active?'':' (inativo)'}</option>`).join('');
    form.elements.assignee.value=task?.assignee_id||profile.id;
    form.elements.lab.innerHTML='<option value="">Sem laboratório</option>'+labs.filter(l=>l.active||l.id===task?.lab_id).map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join('');form.elements.lab.value=task?.lab_id||'';
    form.elements.ticket.innerHTML='<option value="">Sem chamado</option>'+(task?.ticket_id?`<option value="${task.ticket_id}">${esc(ticketNames.get(task.ticket_id)||'Chamado vinculado')}</option>`:'');form.elements.ticket.value=task?.ticket_id||'';
    dialog.querySelector('#taskFormError').textContent='';dialog.querySelector('#taskHistory').hidden=!task;dialog.querySelector('#taskHistory').open=false;
    dialog.querySelector('#deleteStaffTask').hidden=!task;dialog.querySelector('#taskDeleteConfirmation').hidden=true;
    dialog.querySelector('#taskTicketHint').textContent='O vínculo é apenas uma referência; não muda o chamado.';
    dialog.showModal();form.elements.title.focus();
    if(task?.ticket_id){
      const id=task.id,generation=searchGeneration;
      const result=await db().from('tickets').select('id,protocol,title').eq('id',task.ticket_id).maybeSingle();
      if(result.data&&dialog.open&&editing?.id===id&&generation===searchGeneration){ticketNames.set(result.data.id,result.data.protocol);form.elements.ticket.options[1].textContent=`${result.data.protocol} · ${result.data.title}`;}
    }
  }
  async function findTicket(){
    const query=dialog.querySelector('#taskTicketSearch').value.trim(),generation=++searchGeneration;
    if(query.length<3){dialog.querySelector('#taskTicketHint').textContent='Digite pelo menos 3 caracteres do protocolo.';return;}
    dialog.querySelector('#taskTicketHint').textContent='Buscando…';
    const result=await db().from('tickets').select('id,protocol,title').ilike('protocol','%'+query.replace(/[%_]/g,'')+'%').order('created_at',{ascending:false}).limit(30);
    if(generation!==searchGeneration||!dialog.open)return;
    if(result.error){dialog.querySelector('#taskTicketHint').textContent=errorText(result.error);return;}
    const select=dialog.querySelector('[name=ticket]'),selected=select.value,previous=select.selectedOptions[0]?.textContent;
    const found=result.data||[];found.forEach(t=>ticketNames.set(t.id,t.protocol));
    select.innerHTML='<option value="">Sem chamado</option>'+found.map(t=>`<option value="${t.id}">${esc(t.protocol)} · ${esc(t.title)}</option>`).join('')+(selected&&!found.some(t=>t.id===selected)?`<option value="${selected}">${esc(previous)}</option>`:'');
    select.value=selected;dialog.querySelector('#taskTicketHint').textContent=found.length?`${found.length} resultado(s). Selecione o chamado desejado.`:'Nenhum chamado encontrado.';
  }
  async function loadHistory(){
    const id=editing?.id;if(!id)return;
    const box=dialog.querySelector('#taskHistoryList');box.textContent='Carregando…';
    const result=await db().from('staff_task_events').select('actor_id,old_data,new_data,created_at').eq('task_id',id).order('created_at',{ascending:false}).limit(30);
    if(editing?.id!==id||!dialog.open)return;
    box.innerHTML=result.error?esc(errorText(result.error)):(result.data||[]).map(e=>`<p><b>${esc(e.actor_id?(people.find(p=>p.id===e.actor_id)?.full_name||'Técnico'):'Sistema')}</b> · ${esc(new Date(e.created_at).toLocaleString('pt-BR'))}<br>${e.old_data?e.old_data.status!==e.new_data.status?`${esc(statuses[e.old_data.status])} → ${esc(statuses[e.new_data.status])}`:'Atualizou os dados da tarefa.':'Criou a tarefa.'}</p>`).join('');
  }
  async function save(event){
    event.preventDefault();if(busy)return;
    const form=event.currentTarget;if(!form.reportValidity())return;
    busy=true;const controls=[...form.querySelectorAll('button,input,select,textarea')];controls.forEach(c=>c.disabled=true);
    dialog.querySelector('#taskFormError').textContent='';
    try{
      const {error}=await db().rpc('save_staff_task',{p_id:editing?.id||null,p_title:form.elements.title.value.trim(),p_description:form.elements.description.value,p_status:form.elements.status.value,p_lab:form.elements.lab.value||null,p_ticket:form.elements.ticket.value||null,p_assignee:form.elements.assignee.value,p_version:editing?.version||null});
      if(error)throw error;dialog.close();notify(editing?'Tarefa atualizada.':'Tarefa criada.');
    }catch(error){dialog.querySelector('#taskFormError').textContent=errorText(error);}
    finally{busy=false;controls.forEach(c=>c.disabled=false);if(!dialog.open)await refresh();}
  }
  async function remove(){
    if(busy||!editing)return;
    busy=true;const controls=[...dialog.querySelectorAll('button,input,select,textarea')];controls.forEach(c=>c.disabled=true);
    dialog.querySelector('#taskFormError').textContent='';
    try{
      const {error}=await db().rpc('delete_staff_task',{p_id:editing.id,p_version:editing.version});
      if(error)throw error;dialog.close();notify('Tarefa excluída do quadro. Histórico preservado.');
    }catch(error){dialog.querySelector('#taskFormError').textContent=errorText(error);}
    finally{busy=false;controls.forEach(c=>c.disabled=false);if(!dialog.open)await refresh();}
  }
  async function open(user){
    if(!user||user.role!=='tecnico'){notify('Área exclusiva dos técnicos.');return;}
    profile=user;mount();document.querySelector('#adminView').append(section);section.classList.remove('tasks-docked');$('#expandStaffTasks').hidden=true;$('.tasks-toolbar h2').textContent='Um passo de cada vez.';
    document.querySelectorAll('.admin-section').forEach(s=>s.hidden=true);section.hidden=false;
    document.querySelector('#adminTitle').textContent='Tarefas';document.querySelector('#adminSubtitle').textContent='Planeje as atividades do setor e acompanhe cada etapa.';
    document.querySelector('#adminMenuDropdown').hidden=true;
    await refresh();
  }
  async function dock(user){
    if(!user||user.role!=='tecnico')return;
    profile=user;mount();
    const queue=document.querySelector('#ticketsSection .queue');if(!queue)return;
    let workspace=document.querySelector('#ticketTasksWorkspace');
    if(!workspace){workspace=document.createElement('div');workspace.id='ticketTasksWorkspace';queue.before(workspace);workspace.append(queue);}
    workspace.append(section);section.classList.add('tasks-docked');section.hidden=false;$('#expandStaffTasks').hidden=false;$('.tasks-toolbar h2').textContent='Tarefas da equipe';
    await refresh();
  }
  window.labinfoTasks={open,dock,filterTasks};
})();
