(()=>{
// Pure, immutable snapshots. `slot` is a logical element's visual position;
// array `cells` separately preserve the copy semantics of each assignment.
const OPERATIONS = new Set(['insert', 'delete', 'read', 'update']);

const CODE = Object.freeze({
  array: Object.freeze({
    insert: Object.freeze([
      'for (let j = length; j > index; j--) {',
      '  A[j] = A[j - 1];',
      '}',
      'A[index] = value;',
      'length += 1;',
    ]),
    delete: Object.freeze([
      'const removed = A[index];',
      'for (let j = index; j < length - 1; j++) {',
      '  A[j] = A[j + 1];',
      '}',
      'length -= 1;',
      'A[length] = empty;',
    ]),
    read: Object.freeze([
      'const address = base + index * size;',
      'return A[index];',
    ]),
    update: Object.freeze([
      'const address = base + index * size;',
      'A[index] = value;',
    ]),
  }),
  list: Object.freeze({
    insert: Object.freeze([
      'let prev = head;',
      'for (let j = 0; j < index; j++) {',
      '  prev = prev.next;',
      '}',
      'const newNode = new Node(value);',
      'newNode.next = prev.next;',
      'prev.next = newNode;',
      'length += 1;',
    ]),
    wrongInsert: Object.freeze([
      'let prev = head;',
      'for (let j = 0; j < index; j++) {',
      '  prev = prev.next;',
      '}',
      'const newNode = new Node(value);',
      'prev.next = newNode;',
      'newNode.next = prev.next;',
    ]),
    delete: Object.freeze([
      'let prev = head;',
      'for (let j = 0; j < index; j++) {',
      '  prev = prev.next;',
      '}',
      'let target = prev.next;',
      'prev.next = target.next;',
      'target = null;',
      'length -= 1;',
    ]),
    read: Object.freeze([
      'let current = head.next;',
      'for (let j = 0; j < index; j++) {',
      '  current = current.next;',
      '}',
      'return current.data;',
    ]),
    update: Object.freeze([
      'let current = head.next;',
      'for (let j = 0; j < index; j++) {',
      '  current = current.next;',
      '}',
      'current.data = value;',
    ]),
  }),
});

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function validate({ values, index, value, operation, capacity }) {
  if (!Array.isArray(values) || Array.from(values).some(v => !Number.isSafeInteger(v))) {
    throw new RangeError('数据须为整数');
  }
  if (!OPERATIONS.has(operation)) throw new RangeError('请选择操作');
  if (!Number.isInteger(index) || index < 0 || index > values.length - (operation === 'insert' ? 0 : 1)) {
    throw new RangeError(operation === 'insert' ? `下标范围为 0–${values.length}` : values.length ? `下标范围为 0–${values.length - 1}` : '请先插入元素');
  }
  if ((operation === 'insert' || operation === 'update') && !Number.isSafeInteger(value)) {
    throw new RangeError('请输入整数');
  }
  if (capacity !== undefined) {
    if (!Number.isInteger(capacity) || capacity < 1 || values.length > capacity) throw new RangeError('容量不足');
    if (operation === 'insert' && values.length === capacity) throw new RangeError('顺序表已满');
  }
}

function makeState(values) {
  return {
    nodes: values.map((value, i) => ({ id: `n${i}`, value, slot: i, role: 'normal', opacity: 1 })),
    edges: [],
    metrics: { length: values.length, moves: 0, reads: 0, writes: 0, pointerWrites: 0 },
    activeIndex: null,
    focusIds: [],
    status: '',
    codeLine: -1,
    event: 'ready',
    done: false,
  };
}

function resetRoles(state) {
  for (const node of state.nodes) {
    if (!['removed', 'unreachable'].includes(node.role)) node.role = node.id === 'new' ? 'new' : 'normal';
  }
  for (const edge of state.edges) edge.role = edge.role === 'unreachable' ? 'unreachable' : 'normal';
  state.focusIds = [];
}

function capture(frames, state, changes = {}) {
  Object.assign(state, changes);
  frames.push(freezeDeep({
    ...state,
    nodes: state.nodes.map(n => ({ ...n })),
    edges: state.edges.map(e => ({ ...e })),
    metrics: { ...state.metrics },
    focusIds: [...state.focusIds],
    ...(state.cells ? { cells: [...state.cells] } : {}),
  }));
}

const labels = { insert: '插入', delete: '删除', read: '读取', update: '修改' };

function buildArrayTimeline({ values, index, value, operation, capacity = 8 }) {
  validate({ values, index, value, operation, capacity });
  const frames = [];
  const state = makeState(values);
  state.capacity = capacity;
  state.cells = Array.from({ length: capacity }, (_, i) => values[i] ?? null);
  state.activeIndex = index;
  const code = CODE.array[operation];
  const result = [...values];
  let readValue;

  if (operation === 'insert') {
    state.nodes.push({ id: 'new', value, slot: -1, role: 'new', opacity: 1 });
    capture(frames, state, { status: `在下标 ${index} 插入 ${value}`, focusIds: ['new'] });
    for (let j = values.length - 1; j >= index; j--) {
      resetRoles(state);
      const node = state.nodes.find(n => n.id === `n${j}`);
      node.slot = j + 1;
      node.role = 'active';
      state.cells[j + 1] = state.cells[j];
      state.metrics.moves++;
      state.metrics.reads++;
      state.metrics.writes++;
      capture(frames, state, { status: `${node.value} 右移：${j} → ${j + 1}`, codeLine: 1, focusIds: [node.id], event: 'move', activeIndex: j + 1, fromIndex: j, toIndex: j + 1 });
    }
    resetRoles(state);
    state.nodes.find(n => n.id === 'new').slot = index;
    state.cells[index] = value;
    state.metrics.writes++;
    capture(frames, state, { status: `${value} 写入下标 ${index}`, codeLine: 3, focusIds: ['new'], event: 'insert', activeIndex: index, fromIndex: -1, toIndex: index });
    state.metrics.length++;
    result.splice(index, 0, value);
    capture(frames, state, { status: `插入完成 · 移动 ${state.metrics.moves} 次`, codeLine: 4, event: 'complete', done: true });
  } else if (operation === 'delete') {
    const target = state.nodes[index];
    target.role = 'active';
    capture(frames, state, { status: `删除下标 ${index} · ${target.value}`, focusIds: [target.id] });
    target.role = 'removed';
    target.opacity = 0;
    state.metrics.reads++;
    readValue = target.value;
    capture(frames, state, { status: `取出 ${target.value}`, codeLine: 0, event: 'remove' });
    for (let j = index + 1; j < values.length; j++) {
      resetRoles(state);
      const node = state.nodes.find(n => n.id === `n${j}`);
      node.slot = j - 1;
      node.role = 'active';
      state.cells[j - 1] = state.cells[j];
      state.metrics.moves++;
      state.metrics.reads++;
      state.metrics.writes++;
      capture(frames, state, { status: `${node.value} 左移：${j} → ${j - 1}`, codeLine: 2, focusIds: [node.id], activeIndex: j - 1, event: 'move', fromIndex: j, toIndex: j - 1 });
    }
    resetRoles(state);
    state.metrics.length--;
    capture(frames, state, { status: `长度 ${values.length} → ${state.metrics.length}`, codeLine: 4, event: 'length', focusIds: [], activeIndex: null });
    state.cells[state.metrics.length] = null;
    state.metrics.writes++;
    result.splice(index, 1);
    capture(frames, state, { status: `删除完成 · 移动 ${state.metrics.moves} 次`, codeLine: 5, event: 'complete', done: true });
  } else {
    const target = state.nodes[index];
    capture(frames, state, { status: `${labels[operation]}下标 ${index}`, activeIndex: index });
    target.role = 'active';
    capture(frames, state, { status: `直接定位 A[${index}]`, codeLine: 0, focusIds: [target.id], event: 'locate' });
    if (operation === 'read') {
      state.metrics.reads++;
      readValue = target.value;
      capture(frames, state, { status: `A[${index}] = ${target.value}`, codeLine: 1, event: 'complete', readValue, done: true });
    } else {
      const oldValue = target.value;
      target.value = value;
      state.cells[index] = value;
      result[index] = value;
      state.metrics.writes++;
      capture(frames, state, { status: `A[${index}]：${oldValue} → ${value}`, codeLine: 1, event: 'complete', done: true });
    }
  }
  const constant = ['read', 'update'].includes(operation) || (operation === 'insert' && index === values.length) || (operation === 'delete' && index === values.length - 1);
  return freezeDeep({ frames, code, result, complexity: constant ? 'O(1)' : 'O(n)', title: `顺序表${labels[operation]}`, ...(readValue !== undefined ? { readValue } : {}) });
}

function setEdge(state, from, to, role = 'active') {
  const edge = state.edges.find(e => e.from === from);
  if (edge) Object.assign(edge, { to, role });
  else state.edges.push({ from, to, role });
}

function focusNode(state, id) {
  resetRoles(state);
  const node = state.nodes.find(n => n.id === id);
  if (node) node.role = 'active';
  state.focusIds = [id];
}

// `head` is a sentinel, so insertion/deletion at index 0 uses the same algorithm.
function buildListTimeline({ values, index, value, operation, wrongOrder = false }) {
  validate({ values, index, value, operation });
  const frames = [];
  const state = makeState(values);
  state.edges = [{ from: 'head', to: values.length ? 'n0' : null, role: 'normal' },
    ...values.map((_, i) => ({ from: `n${i}`, to: i + 1 < values.length ? `n${i + 1}` : null, role: 'normal' }))];
  state.activeIndex = index;
  const badOrder = wrongOrder && operation === 'insert';
  const code = CODE.list[badOrder ? 'wrongInsert' : operation];
  const result = [...values];
  let readValue;
  if (operation === 'insert') {
    state.nodes.push({ id: 'new', value, slot: -1, role: 'new', opacity: 1 });
    state.edges.push({ from: 'new', to: null, role: 'new' });
  }
  capture(frames, state, { status: `${labels[operation]}下标 ${index}${operation === 'insert' ? ` · ${value}` : ''}` });

  if (operation === 'insert' || operation === 'delete') {
    let prev = 'head';
    focusNode(state, prev);
    capture(frames, state, { status: '前驱从 head 出发', codeLine: 0, focusIds: [prev], event: 'locate', predecessor: prev });
    for (let j = 0; j < index; j++) {
      prev = `n${j}`;
      focusNode(state, prev);
      state.metrics.reads++;
      const incoming = state.edges.find(e => e.to === prev);
      if (incoming) incoming.role = 'active';
      capture(frames, state, { status: `沿 next 到达 ${values[j]}`, codeLine: 2, activeIndex: j, event: 'traverse', predecessor: prev });
    }
    const successor = index < values.length ? `n${index}` : null;
    if (operation === 'insert') {
      focusNode(state, prev);
      state.focusIds.push('new');
      capture(frames, state, { status: `新建节点 ${value}`, codeLine: 4, event: 'allocate', activeIndex: index, successor });
      if (badOrder) {
        resetRoles(state);
        setEdge(state, prev, 'new');
        state.metrics.pointerWrites++;
        for (const node of state.nodes) {
          if (node.id !== 'new' && node.slot >= index) {
            node.role = 'unreachable';
            node.opacity = 0.38;
            node.offsetY = 88;
          }
        }
        for (const edge of state.edges) {
          if (state.nodes.find(n => n.id === edge.from)?.role === 'unreachable') edge.role = 'unreachable';
        }
        capture(frames, state, {
          status: successor ? '前驱已改指向 · 原后继不可达' : '前驱已指向新节点',
          codeLine: 5, event: 'disconnect', focusIds: [prev, 'new'], error: true,
          unreachableIds: values.slice(index).map((_, j) => `n${index + j}`),
        });
        setEdge(state, 'new', 'new', 'error');
        state.metrics.pointerWrites++;
        capture(frames, state, { status: 'newNode.next 指向自身', codeLine: 6, event: 'self-loop', focusIds: ['new'], error: true, done: true });
        // A cyclic result has no finite list value. `result` retains the input
        // so a UI never commits a deliberately broken demonstration.
        return freezeDeep({ frames, code, result, complexity: index === 0 ? 'O(1)' : 'O(n)', title: '链表插入 · 颠倒时序', valid: false, cycle: 'new', unreachable: values.slice(index) });
      }
      resetRoles(state);
      setEdge(state, 'new', successor, 'new');
      state.metrics.pointerWrites++;
      state.metrics.reads++;
      capture(frames, state, { status: successor ? `${value}.next → ${values[index]}` : `${value}.next → null`, codeLine: 5, event: 'connect-successor', focusIds: ['new', ...(successor ? [successor] : [])] });
      resetRoles(state);
      setEdge(state, prev, 'new');
      state.metrics.pointerWrites++;
      for (const node of state.nodes) {
        if (node.id !== 'new' && node.slot >= index) node.slot++;
      }
      state.nodes.find(n => n.id === 'new').slot = index;
      capture(frames, state, { status: `${prev === 'head' ? 'head' : values[index - 1]}.next → ${value}`, codeLine: 6, event: 'connect-predecessor', focusIds: [prev, 'new'] });
      state.metrics.length++;
      result.splice(index, 0, value);
      capture(frames, state, { status: '插入完成 · 2 次指针修改', codeLine: 7, event: 'complete', done: true });
    } else {
      const target = state.nodes[index];
      focusNode(state, target.id);
      state.metrics.reads++;
      readValue = target.value;
      capture(frames, state, { status: `定位待删节点 ${target.value}`, codeLine: 4, event: 'locate-target', focusIds: [prev, target.id], activeIndex: index });
      const next = index + 1 < values.length ? `n${index + 1}` : null;
      resetRoles(state);
      setEdge(state, prev, next);
      state.metrics.pointerWrites++;
      state.metrics.reads++;
      target.role = 'removed';
      target.opacity = 0.62;
      target.offsetY = 58;
      capture(frames, state, { status: `${prev === 'head' ? 'head' : values[index - 1]}.next → ${next ? values[index + 1] : 'null'}`, codeLine: 5, event: 'bypass', focusIds: [prev, ...(next ? [next] : [])] });
      target.opacity = 0;
      state.edges = state.edges.filter(e => e.from !== target.id);
      capture(frames, state, { status: `移除节点 ${target.value}`, codeLine: 6, event: 'remove', focusIds: [target.id] });
      for (const node of state.nodes) if (node.id !== target.id && node.slot > index) node.slot--;
      state.metrics.length--;
      result.splice(index, 1);
      capture(frames, state, { status: '删除完成', codeLine: 7, event: 'complete', focusIds: [], activeIndex: null, done: true });
    }
  } else {
    focusNode(state, 'n0');
    state.metrics.reads++;
    state.edges[0].role = 'active';
    capture(frames, state, { status: `从首节点 ${values[0]} 出发`, codeLine: 0, event: 'locate', activeIndex: 0 });
    for (let j = 1; j <= index; j++) {
      focusNode(state, `n${j}`);
      state.metrics.reads++;
      state.edges.find(e => e.from === `n${j - 1}`).role = 'active';
      capture(frames, state, { status: `沿 next 到达 ${values[j]} · 下标 ${j}`, codeLine: 2, event: 'traverse', activeIndex: j });
    }
    const target = state.nodes[index];
    if (operation === 'read') {
      readValue = target.value;
      capture(frames, state, { status: `读取 ${target.value}`, codeLine: 4, event: 'complete', readValue, done: true });
    } else {
      const oldValue = target.value;
      target.value = value;
      state.metrics.writes++;
      result[index] = value;
      capture(frames, state, { status: `${oldValue} → ${value}`, codeLine: 4, event: 'complete', done: true });
    }
  }
  return freezeDeep({ frames, code, result, complexity: index === 0 ? 'O(1)' : 'O(n)', pointerComplexity: ['insert', 'delete'].includes(operation) ? 'O(1)' : undefined, title: `单链表${labels[operation]}`, valid: true, ...(readValue !== undefined ? { readValue } : {}) });
}

const NS = 'http://www.w3.org/2000/svg';
const palettes = {
  normal: { fill: '#eef3f7', stroke: '#d7e2e9', ink: '#486270', accent: '#99afbd' },
  active: { fill: '#fff5df', stroke: '#e7c477', ink: '#96702d', accent: '#d7ab52' },
  new: { fill: '#e5f4ec', stroke: '#8fc7ac', ink: '#2f8264', accent: '#70ad91' },
  removed: { fill: '#f9eaea', stroke: '#dca6a5', ink: '#b37170', accent: '#cd8585' },
  unreachable: { fill: '#eef0f1', stroke: '#c8d0d4', ink: '#8e9b9e', accent: '#a7b0b6' },
};
const edgeColors = { normal: '#a7bac0', active: '#d0a34d', new: '#67ad8f', unreachable: '#bcc6c9', error: '#ce8180' };
const svgEl = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const [k,v] of Object.entries(attrs)) e.setAttribute(k,String(v)); if (text !== undefined) e.textContent = text; return e; };
const mix = (a,b,t) => a + (b-a)*t;
const ease = t => 1 - Math.pow(1-t, 3);
const addressFor = id => id === 'new' ? '0x38B0' : ['0x10A0','0x24F8','0x180C','0x42D0','0x2B60','0x5C20','0x34E8','0x60A4'][Number(id.slice(1)) % 8];

class VisualStage {
  constructor(svg, { type, onConnect, onInteraction, onInspect }) {
    this.svg = svg; this.type = type; this.onConnect = onConnect; this.onInteraction = onInteraction; this.onInspect = onInspect;
    this.positions = new Map(); this.nodeEls = new Map(); this.edgeEls = new Map(); this.offsets = new Map();
    this.frame = null; this.timeline = null; this.raf = 0; this.duration = 520; this.manual = false; this.memory = false; this.drag = null; this.portSelected = null;
    this.abort = new AbortController(); this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    svg.setAttribute('viewBox','0 0 900 340'); svg.setAttribute('role','group'); svg.setAttribute('aria-label', type==='array'?'顺序表内存画布':'可拖动的单链表画布'); svg.classList.add(type);
    const defs = svgEl('defs');
    for (const [name,color] of Object.entries(edgeColors)) {
      const marker = svgEl('marker', { id:`arrow-${name}`, viewBox:'0 0 10 10', refX:8, refY:5, markerWidth:5.5, markerHeight:5.5, orient:'auto-start-reverse' });
      marker.append(svgEl('path',{d:'M 0 1 L 9 5 L 0 9 z',fill:color})); defs.append(marker);
    }
    const filter = svgEl('filter',{id:'node-shadow',x:'-20%',y:'-20%',width:'140%',height:'150%'});
    filter.append(svgEl('feDropShadow',{dx:0,dy:5,stdDeviation:4,'flood-color':'#314f52','flood-opacity':.035})); defs.append(filter);
    this.background = svgEl('g'); this.ghostLayer = svgEl('g'); this.edgeLayer = svgEl('g'); this.nodesLayer = svgEl('g'); this.foreground = svgEl('g');
    svg.replaceChildren(defs,this.background,this.ghostLayer,this.edgeLayer,this.nodesLayer,this.foreground);
    const signal = this.abort.signal;
    svg.addEventListener('pointerdown', e=>this.pointerDown(e), {signal});
    svg.addEventListener('pointermove', e=>this.pointerMove(e), {signal});
    svg.addEventListener('pointerup', e=>this.pointerUp(e), {signal});
    svg.addEventListener('pointercancel', ()=>this.cancelDrag(), {signal});
    svg.addEventListener('keydown', e=>this.keyDown(e), {signal});
  }
  setTimeline(timeline, index) {
    cancelAnimationFrame(this.raf); this.timeline = timeline; this.index = index; this.positions.clear(); this.offsets.clear(); this.nodeEls.clear(); this.edgeEls.clear();
    this.background.replaceChildren(); this.ghostLayer.replaceChildren(); this.edgeLayer.replaceChildren(); this.nodesLayer.replaceChildren(); this.foreground.replaceChildren();
    this.nodeCount = Math.max(...timeline.frames.map(f=>f.nodes.filter(n=>n.opacity>0).length));
    this.viewWidth = this.type==='array'?900:Math.max(900,160+this.nodeCount*154);
    this.svg.setAttribute('viewBox',`0 0 ${this.viewWidth} ${this.type==='list'?360:340}`);
    this.drawBackground();
    const unique = new Map(); for (const f of timeline.frames) for (const n of f.nodes) if(!unique.has(n.id)) unique.set(n.id,n);
    for (const node of unique.values()) this.createNode(node);
    this.setFrame(timeline.frames[0],false);
  }
  drawBackground() {
    if(this.type==='array') {
      this.background.append(svgEl('text',{x:43,y:138,fill:'#abb8bf','font-size':9},'INDEX'));
      for(let i=0;i<8;i++) {
        const x=48+i*102;
        const slot=svgEl('rect',{x,y:158,width:88,height:78,rx:13,fill:'#f8fafb',stroke:'#e1e8eb','stroke-dasharray':'4 4','data-slot':i});
        this.background.append(slot,svgEl('text',{x:x+44,y:143,'text-anchor':'middle',fill:'#a5b3ba','font-size':11,'data-index':i},i),svgEl('text',{x:x+44,y:260,'text-anchor':'middle',fill:'#a7b6bc','font-size':9},`0x${(4096+i*4).toString(16).toUpperCase()}`));
      }
      this.background.append(svgEl('path',{d:'M 49 280 v 6 H 849 v -6',stroke:'#e0e8e8',fill:'none'}),svgEl('text',{x:450,y:304,'text-anchor':'middle',fill:'#aab8bc','font-size':9,'letter-spacing':1},'CONTIGUOUS MEMORY'));
      this.trayLabel = svgEl('text',{x:48+this.index*102+44,y:39,'text-anchor':'middle',fill:'#81a696','font-size':9},'NEW');
      this.background.append(this.trayLabel);
    } else {
      const head=svgEl('g',{'data-node':'head',class:'scene-node head-node',tabindex:0,role:'button','aria-label':'head 哨兵节点'});
      head.append(svgEl('rect',{x:19,y:185,width:48,height:50,rx:12,fill:'#f4f7f7',stroke:'#dce5e6','stroke-dasharray':'3 3'}),svgEl('text',{x:43,y:213,'text-anchor':'middle',fill:'#81969b','font-size':12},'H'),svgEl('text',{x:43,y:172,'text-anchor':'middle',fill:'#9bafb3','font-size':9},'head'));
      const port=svgEl('circle',{cx:67,cy:210,r:6,fill:'#fff',stroke:'#a7babf','stroke-width':1.5,'data-port':'head',tabindex:0,role:'button','aria-label':'从 head.next 连线',class:'node-port'});
      head.append(port); this.headGroup=head; this.background.append(head);
      this.background.append(svgEl('text',{x:this.viewWidth/2,y:321,'text-anchor':'middle',fill:'#b0bdc0','font-size':9,'letter-spacing':1},'LINKED MEMORY'));
      this.nullTarget=svgEl('g',{'data-null':'true',tabindex:0,role:'button','aria-label':'空指针 null'});
      this.nullTarget.append(svgEl('rect',{x:this.viewWidth-64,y:191,width:46,height:38,rx:8,fill:'#f7faf9',stroke:'#e1e9e8','stroke-dasharray':'3 3'}),svgEl('text',{x:this.viewWidth-41,y:214,'text-anchor':'middle',fill:'#9aaeb0','font-size':10},'null'));
      this.background.append(this.nullTarget);
    }
  }
  createNode(node) {
    const list=this.type==='list', w=list?116:88, h=list?66:78;
    const g=svgEl('g',{class:'scene-node','data-node':node.id,tabindex:0,role:'button','aria-label':`数值 ${node.value}`});
    const rect=svgEl('rect',{width:w,height:h,rx:13,filter:'url(#node-shadow)',class:'node-box'});
    const value=svgEl('text',{x:list?38:44,y:list?40:49,'text-anchor':'middle','font-size':node.value.toString().length>3?22:27,'font-weight':500,class:'node-value'},node.value);
    g.append(rect);
    if(list) {
      g.append(svgEl('line',{x1:77,y1:1,x2:77,y2:h-1,stroke:'#cfddd9','stroke-opacity':.6}),svgEl('text',{x:38,y:15,'text-anchor':'middle','font-size':7,fill:'#9eb3b4'},'data'),svgEl('text',{x:97,y:19,'text-anchor':'middle','font-size':7,fill:'#95a9aa'},'next'));
      const halo=svgEl('circle',{cx:99,cy:38,r:14,fill:'#68b698','fill-opacity':.16,class:'port-halo'});
      const port=svgEl('circle',{cx:99,cy:38,r:6,fill:'#fff',stroke:'#87b19f','stroke-width':1.6,'data-port':node.id,class:'node-port',tabindex:0,role:'button','aria-label':`从节点 ${node.value} 的 next 连线`});
      g.append(halo,port,svgEl('text',{x:58,y:86,'text-anchor':'middle','font-size':8,fill:'#9caeb4'},addressFor(node.id)));
    } else g.append(svgEl('text',{x:44,y:18,'text-anchor':'middle','font-size':7,fill:'#9bacb5','letter-spacing':1},'DATA'));
    const title=svgEl('title',{},`data: ${node.value}`);g.append(value,title);
    const tag=svgEl('text',{x:w/2,y:-12,'text-anchor':'middle','font-size':9,fill:'#95a6ae',class:'node-tag'});g.append(tag);
    this.nodesLayer.append(g);this.nodeEls.set(node.id,{g,rect,value,title,tag});
  }
  basePosition(node) {
    if(this.type==='array') return {x:48+(node.slot===-1?this.index:node.slot)*102,y:node.slot===-1?51:158,opacity:node.opacity??1};
    const step=154,offset=this.offsets.get(node.id)||{x:0,y:0};
    const prepX=Math.min(this.viewWidth-180,Math.max(103,103+(this.index-.48)*step));
    return {x:(node.slot===-1?prepX:103+node.slot*step)+offset.x,y:(node.slot===-1?55:177)+(node.offsetY||0)+offset.y,opacity:node.opacity??1};
  }
  setFrame(frame,animate=true) {
    cancelAnimationFrame(this.raf);this.frame=frame;this.cancelDrag();
    const from=new Map(this.positions),to=new Map();
    for(const n of frame.nodes) {
      const p=this.basePosition(n);to.set(n.id,p);
      if(!from.has(n.id)) from.set(n.id,{...p,opacity:0});
      this.styleNode(n,frame);
    }
    for(const [id,p] of from) if(!to.has(id)) to.set(id,{...p,opacity:0});
    this.updateBackground(frame);this.prepareEdges(frame);
    const begin=performance.now(),duration=animate&&!this.reduced?this.duration:0;
    const draw=now=>{
      const t=duration?Math.min(1,(now-begin)/duration):1,p=ease(t);
      for(const [id,target] of to) {
        const old=from.get(id)||target,moving=Math.abs(old.x-target.x)>5&&Math.abs(old.y-target.y)<5;
        const lift=this.type==='array'&&moving?Math.sin(Math.PI*p)*24:0;
        const pos={x:mix(old.x,target.x,p),y:mix(old.y,target.y,p)-lift,opacity:mix(old.opacity??1,target.opacity,p)};
        this.positions.set(id,pos);this.paintNode(id,pos);
      }
      this.drawEdges(p);
      if(t<1)this.raf=requestAnimationFrame(draw);
    };draw(begin);
  }
  styleNode(node,frame) {
    const el=this.nodeEls.get(node.id);if(!el)return;
    const c=palettes[node.role]||palettes.normal;
    el.rect.setAttribute('fill',c.fill);el.rect.setAttribute('stroke',c.stroke);el.rect.setAttribute('stroke-width',frame.focusIds.includes(node.id)?1.6:1);
    el.value.setAttribute('fill',c.ink);el.value.textContent=node.value;
    el.value.setAttribute('font-size',String(node.value).length>3?22:27);
    el.g.setAttribute('aria-label',`数值 ${node.value}，${node.slot<0?'待插入':`下标 ${node.slot}`}`);
    el.g.setAttribute('tabindex',node.opacity===0?'-1':'0');
    el.g.setAttribute('aria-hidden',String(node.opacity===0));
    el.g.style.pointerEvents=node.opacity===0?'none':'auto';
    el.title.textContent=this.type==='array'?`index: ${node.slot} · data: ${node.value}`:`data: ${node.value} · address: ${addressFor(node.id)}`;
    el.tag.textContent=this.type==='list'?(node.role==='unreachable'?'不可达':node.slot===-1?'newNode':frame.predecessor===node.id&&frame.focusIds.includes(node.id)?'prev':frame.activeIndex===node.slot?`index ${node.slot}`:''):'';
    el.tag.setAttribute('fill',node.role==='unreachable'?'#c28687':node.slot===-1?'#70a58b':'#a6b5b9');
  }
  paintNode(id,pos) { const el=this.nodeEls.get(id);if(el){el.g.setAttribute('transform',`translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})`);el.g.setAttribute('opacity',pos.opacity.toFixed(3));} }
  updateBackground(frame) {
    if(this.type==='array') {
      this.trayLabel.setAttribute('opacity',frame.nodes.some(n=>n.id==='new'&&n.slot===-1)?1:0);
      for(const rect of this.background.querySelectorAll('[data-slot]')) {
        const active=+rect.dataset.slot===frame.activeIndex;
        rect.setAttribute('fill',active?'#fffaf0':'#f8fafb');rect.setAttribute('stroke',active?'#e4ca90':'#e1e8eb');
      }
      this.drawGhosts();
    } else {
      const active=frame.focusIds.includes('head');
      this.headGroup.firstElementChild.setAttribute('stroke',active?'#d8b05b':'#dce5e6');
      this.headGroup.firstElementChild.setAttribute('fill',active?'#fff6e5':'#f4f7f7');
    }
  }
  drawGhosts(){
    this.ghostLayer.replaceChildren();if(!this.memory||!this.frame?.cells)return;
    this.frame.cells.forEach((v,i)=>{
      if(v===null||this.frame.nodes.some(n=>n.slot===i&&n.opacity>0.9&&n.value===v))return;
      this.ghostLayer.append(svgEl('text',{x:48+i*102+44,y:205,'text-anchor':'middle','font-size':24,fill:'#b9c9ce','fill-opacity':.7},v),svgEl('text',{x:48+i*102+44,y:222,'text-anchor':'middle','font-size':7,fill:'#a5b8bc'},'COPY'));
    });
  }
  prepareEdges(frame) {
    for(const obj of this.edgeEls.values())obj.seen=false;
    for(const edge of frame.edges) {
      let obj=this.edgeEls.get(edge.from);
      if(!obj){const path=svgEl('path',{fill:'none','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round'});this.edgeLayer.append(path);obj={path,old:edge,edge,seen:true};this.edgeEls.set(edge.from,obj);}
      obj.old=obj.edge;obj.edge=edge;obj.seen=true;
      const role=edge.role in edgeColors?edge.role:'normal';
      obj.path.setAttribute('stroke',edgeColors[role]);obj.path.setAttribute('marker-end',`url(#arrow-${role})`);
      obj.path.setAttribute('stroke-dasharray',role==='unreachable'?'4 5':'');
    }
    for(const [key,obj] of this.edgeEls)if(!obj.seen){obj.path.remove();this.edgeEls.delete(key);}
  }
  sourcePoint(id){if(id==='head')return{x:67,y:210};const p=this.positions.get(id)||{x:100,y:177};return{x:p.x+105,y:p.y+38};}
  targetPoint(id,source){if(id===null)return{x:this.viewWidth-66,y:210};const p=this.positions.get(id)||{x:100,y:177};return{x:p.x-5,y:p.y+33};}
  drawEdges(t=1) {
    if(this.type!=='list')return;
    for(const obj of this.edgeEls.values()) {
      const edge=obj.edge,a=this.sourcePoint(edge.from),oldB=this.targetPoint(obj.old.to,a),newB=this.targetPoint(edge.to,a),b={x:mix(oldB.x,newB.x,t),y:mix(oldB.y,newB.y,t)};
      let d;
      if(edge.from===edge.to){const p=this.positions.get(edge.from);d=`M${a.x},${a.y} C${a.x+62},${a.y-5} ${a.x+58},${p.y-48} ${p.x+52},${p.y-26} C${p.x+17},${p.y-20} ${p.x-18},${p.y-9} ${p.x-5},${p.y+28}`;}
      else if(Math.abs(a.y-b.y)<18&&b.x>a.x) {
        const bypass=b.x-a.x>175,dy=bypass?-60:0;
        d=`M${a.x},${a.y} C${a.x+(b.x-a.x)*.32},${a.y+dy} ${b.x-(b.x-a.x)*.32},${b.y+dy} ${b.x},${b.y}`;
      } else {const h=Math.max(35,Math.abs(b.x-a.x)*.4);d=`M${a.x},${a.y} C${a.x+h},${a.y} ${b.x-h},${b.y} ${b.x},${b.y}`;}
      obj.path.setAttribute('d',d);
      const p=this.positions.get(edge.from);obj.path.setAttribute('opacity',edge.from==='new'&&edge.to===null?0:edge.role==='unreachable'?.35:p?.opacity??1);
    }
  }
  setManual(enabled){this.manual=enabled;this.svg.classList.toggle('manual',enabled);this.portSelected=null;this.foreground.replaceChildren();}
  setMemory(enabled){this.memory=enabled;this.drawGhosts();}
  resetLayout(){this.offsets.clear();if(this.frame)this.setFrame(this.frame,true);}
  point(event){const p=this.svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform(this.svg.getScreenCTM().inverse());}
  pointerDown(event){
    if(this.type!=='list'||event.button!==0)return;
    if(event.target.closest('[data-null]')&&this.portSelected!==null){const from=this.portSelected;this.portSelected=null;this.foreground.replaceChildren();this.onConnect?.(from,null);event.preventDefault();return;}
    const port=event.target.closest('[data-port]'),body=event.target.closest('[data-node]');
    if(!port&&!body)return;
    if(!port&&body.dataset.node==='head')return;
    this.onInteraction?.();cancelAnimationFrame(this.raf);
    const point=this.point(event);this.svg.setPointerCapture(event.pointerId);
    if(port){
      this.drag={kind:'port',id:port.dataset.port,point,pointerId:event.pointerId};
      this.dragLine=svgEl('path',{fill:'none',stroke:'#4b9d83','stroke-width':2,'stroke-dasharray':'5 4'});this.foreground.replaceChildren(this.dragLine);
      const p=this.sourcePoint(this.drag.id);this.dragLine.setAttribute('d',`M${p.x},${p.y} L${point.x},${point.y}`);
    }else{
      const id=body.dataset.node,p=this.positions.get(id),offset=this.offsets.get(id)||{x:0,y:0};
      this.drag={kind:'node',id,point,start:{...p},offset:{...offset},moved:false,pointerId:event.pointerId};body.classList.add('dragging');
    }
    event.preventDefault();
  }
  pointerMove(event){
    if(!this.drag)return;const p=this.point(event),d=this.drag;
    if(d.kind==='node'){
      const dx=p.x-d.point.x,dy=p.y-d.point.y;d.moved=d.moved||Math.abs(dx)+Math.abs(dy)>4;
      const x=Math.max(77,Math.min(this.viewWidth-140,d.start.x+dx)),y=Math.max(29,Math.min(242,d.start.y+dy));
      this.offsets.set(d.id,{x:d.offset.x+x-d.start.x,y:d.offset.y+y-d.start.y});
      const pos={x,y,opacity:d.start.opacity};this.positions.set(d.id,pos);this.paintNode(d.id,pos);this.drawEdges();
    }else{
      const a=this.sourcePoint(d.id);const target=this.findTarget(p);
      const b=target!==undefined?this.targetPoint(target,a):p;const h=Math.max(30,Math.abs(b.x-a.x)*.4);
      this.dragLine.setAttribute('d',`M${a.x},${a.y} C${a.x+h},${a.y} ${b.x-h},${b.y} ${b.x},${b.y}`);
      this.dragLine.setAttribute('stroke',target!==undefined?'#18856b':'#8fb6a6');
    }
  }
  findTarget(p){
    if(Math.abs(p.x-(this.viewWidth-41))<35&&Math.abs(p.y-210)<35)return null;
    for(const [id,pos] of this.positions){if(pos.opacity>.25&&p.x>=pos.x-20&&p.x<=pos.x+116&&p.y>=pos.y-14&&p.y<=pos.y+80)return id;}
    return undefined;
  }
  pointerUp(event){
    if(!this.drag)return;const d=this.drag,p=this.point(event);this.cancelDrag();
    if(d.kind==='port'){
      if(Math.abs(p.x-d.point.x)+Math.abs(p.y-d.point.y)<5){this.portSelected=d.id;this.highlightPort(d.id);}
      else {const to=this.findTarget(p);if(to!==undefined)this.onConnect?.(d.id,to);}
    }else if(!d.moved){
      if(this.portSelected!==null){const from=this.portSelected;this.portSelected=null;this.onConnect?.(from,d.id);}
      else this.onInspect?.(d.id);
    }
  }
  highlightPort(id){this.foreground.replaceChildren();const p=this.sourcePoint(id);this.foreground.append(svgEl('circle',{cx:p.x-6,cy:p.y,r:13,fill:'none',stroke:'#2c9c7e','stroke-width':2}));}
  keyDown(event){
    if(this.type!=='list')return;
    const port=event.target.closest('[data-port]'),node=event.target.closest('[data-node]'),empty=event.target.closest('[data-null]');
    if(['Enter',' '].includes(event.key)&&(port||node||empty)){
      event.preventDefault();event.stopPropagation();this.onInteraction?.();
      if(port){this.portSelected=port.dataset.port;this.highlightPort(this.portSelected);}
      else if(this.portSelected!==null){const from=this.portSelected;this.portSelected=null;this.foreground.replaceChildren();this.onConnect?.(from,empty?null:node.dataset.node);}
      else if(node)this.onInspect?.(node.dataset.node);
    }
    if(event.key==='Escape'){this.portSelected=null;this.foreground.replaceChildren();}
    if(node&&!port&&node.dataset.node!=='head'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
      event.preventDefault();event.stopPropagation();this.onInteraction?.();
      const id=node.dataset.node,offset=this.offsets.get(id)||{x:0,y:0},position=this.positions.get(id);
      const dx=event.key==='ArrowRight'?12:event.key==='ArrowLeft'?-12:0,dy=event.key==='ArrowDown'?12:event.key==='ArrowUp'?-12:0;
      offset.x+=Math.max(77,Math.min(this.viewWidth-140,position.x+dx))-position.x;offset.y+=Math.max(29,Math.min(242,position.y+dy))-position.y;
      this.offsets.set(id,offset);this.setFrame(this.frame,false);this.nodeEls.get(id)?.g.focus();
    }
  }
  cancelDrag(){if(this.drag){this.nodeEls.get(this.drag.id)?.g.classList.remove('dragging');try{this.svg.releasePointerCapture(this.drag.pointerId);}catch{}this.drag=null;}this.dragLine=null;if(this.portSelected===null)this.foreground.replaceChildren();}
  destroy(){cancelAnimationFrame(this.raf);this.abort.abort();}
}

const iconArrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
const iconPlay = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 10 7-10 7Z"/></svg>';
const iconPause = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
const iconReset = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1.4 7M4 4v6h6"/></svg>';
const number = value => Number(value).toLocaleString('en-US');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function mountIntro(container, { onNavigate = () => {} } = {}) {
  const abort = new AbortController();
  const values = [23, 45, 12, 67];
  const addresses = ['0x30A0', '0x10F8', '0x58C4', '0x2060'];
  container.innerHTML = `
    <section class="ex-intro" aria-label="存储方式探索">
      <div class="ex-scene-heading"><div><span class="ex-eyebrow">TWO WAYS TO STORE</span><h1>存储方式探索</h1></div><span class="ex-scene-mark">01 / EXPLORE</span></div>
      <div class="ex-intro-grid">
        <article class="ex-story-card ex-story-array">
          <div class="ex-card-heading"><span class="ex-card-number">01</span><div><h3>一排寄存柜</h3><span>顺序表 · 连续存储</span></div><span class="ex-structure-symbol">[ ]</span></div>
          <div class="ex-locker-scene">
            <div class="ex-locker-rail" aria-label="选择寄存柜">${values.map((v,i)=>`<button class="ex-locker ${i === 1 ? 'ex-selected' : ''}" data-locker="${i}" aria-pressed="${i === 1}" aria-label="下标 ${i}，数值 ${v}"><span class="ex-locker-index">0${i}</span><span class="ex-locker-door"><span class="ex-locker-vents"></span><span class="ex-locker-handle"></span></span><strong>${v}</strong><span class="ex-locker-base"></span></button>`).join('')}</div>
            <div class="ex-address-track"><span>0x1000</span><span>0x1004</span><span>0x1008</span><span>0x100C</span></div>
          </div>
          <div class="ex-inspect-strip" data-array-inspect aria-live="polite"><span>index <b>1</b></span><span>address <b>0x1004</b></span><span>data <b>45</b></span></div>
          <div class="ex-story-footer"><code>address = base + index × 4</code><button class="ex-open-scene" data-open="array">探索顺序表 ${iconArrow}</button></div>
        </article>
        <article class="ex-story-card ex-story-list">
          <div class="ex-card-heading"><span class="ex-card-number">02</span><div><h3>一串寻宝线索</h3><span>单链表 · 指针连接</span></div><span class="ex-structure-symbol">↗</span></div>
          <div class="ex-notes-scene">
            <svg class="ex-note-links" viewBox="0 0 480 218" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="ex-note-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8" fill="#82b7ad"/></marker></defs><path d="M108 87 C154 87 124 155 166 155"/><path d="M242 155 C289 155 240 66 290 66"/><path d="M366 66 C406 66 362 151 403 151"/></svg>
            ${values.map((v,i)=>`<button class="ex-note ex-note-${i} ${i === 1 ? 'ex-selected' : ''}" data-note="${i}" aria-pressed="${i === 1}" aria-label="节点 ${v}，地址 ${addresses[i]}"><span class="ex-note-pin"></span><span class="ex-note-label">${i === 0 ? 'HEAD' : `NODE ${i}`}</span><strong>${v}</strong><span class="ex-note-pointer">next ${i < 3 ? '↗' : '∅'}</span><span class="ex-note-address">${addresses[i]}</span></button>`).join('')}
          </div>
          <div class="ex-inspect-strip" data-list-inspect aria-live="polite"><span>index <b>1</b></span><span>address <b>0x10F8</b></span><span>next <b>0x58C4</b></span></div>
          <div class="ex-story-footer"><code>head → next → next</code><button class="ex-open-scene" data-open="list">探索单链表 ${iconArrow}</button></div>
        </article>
      </div>
      <div class="ex-intro-bottom"><span class="ex-bottom-line"></span><span>逻辑顺序一致 · 物理存储不同</span><span class="ex-bottom-line"></span></div>
    </section>`;
  container.addEventListener('click', event => {
    const locker = event.target.closest('[data-locker]');
    const note = event.target.closest('[data-note]');
    const open = event.target.closest('[data-open]');
    if (open) { onNavigate(open.dataset.open); return; }
    if (locker) {
      const i = Number(locker.dataset.locker);
      container.querySelectorAll('[data-locker]').forEach(el => { const selected = el === locker; el.classList.toggle('ex-selected', selected); el.setAttribute('aria-pressed', String(selected)); });
      container.querySelector('[data-array-inspect]').innerHTML = `<span>index <b>${i}</b></span><span>address <b>0x${(0x1000+i*4).toString(16).toUpperCase()}</b></span><span>data <b>${values[i]}</b></span>`;
    }
    if (note) {
      const i = Number(note.dataset.note);
      container.querySelectorAll('[data-note]').forEach(el => { const selected = el === note; el.classList.toggle('ex-selected', selected); el.classList.toggle('ex-visited', Number(el.dataset.note) < i); el.setAttribute('aria-pressed', String(selected)); });
      container.querySelector('[data-list-inspect]').innerHTML = `<span>index <b>${i}</b></span><span>address <b>${addresses[i]}</b></span><span>next <b>${addresses[i+1] || 'null'}</b></span>`;
    }
  }, { signal: abort.signal });
  return () => abort.abort();
}

// Counts are model primitives: element moves, data accesses, and pointer operations.
function benchmarkModel({ size, index, operation, knownPredecessor = false }) {
  const n = clamp(Math.trunc(Number(size) || 10), 10, 10000);
  const i = clamp(Math.trunc(Number(index) || 0), 0, operation === 'insert' ? n : n - 1);
  let array, list, arrayFormula, listFormula;
  const search = knownPredecessor ? 0 : i;
  if (operation === 'insert') {
    array = [{ label: '元素移动', count: n-i }, { label: '数据写入', count: 1 }];
    list = [{ label: '沿链访问', count: search }, { label: '指针改写', count: 2 }];
    arrayFormula = `${number(n)} − ${number(i)} + 1`;
    listFormula = `${number(search)} + 2`;
  } else if (operation === 'delete') {
    array = [{ label: '元素移动', count: n-i-1 }, { label: '数据写入', count: 1 }];
    list = [{ label: '沿链访问', count: search }, { label: '指针改写', count: 1 }];
    arrayFormula = `${number(n)} − ${number(i)} − 1 + 1`;
    listFormula = `${number(search)} + 1`;
  } else {
    const label = operation === 'update' ? '数据写入' : '数据读取';
    array = [{ label, count: 1 }];
    list = [{ label: '沿链访问', count: i }, { label, count: 1 }];
    arrayFormula = '1';
    listFormula = `${number(i)} + 1`;
  }
  const mutation = operation === 'insert' || operation === 'delete';
  return {
    n, i, operation, knownPredecessor,
    array: { parts: array, total: array.reduce((sum,p) => sum+p.count,0), formula: arrayFormula, complexity: !mutation || i === (operation === 'insert' ? n : n-1) ? 'O(1)' : 'O(n)' },
    list: { parts: list, total: list.reduce((sum,p) => sum+p.count,0), formula: listFormula, complexity: i === 0 || (mutation && knownPredecessor) ? 'O(1)' : 'O(n)' }
  };
}

function mountBenchmark(container, { onNavigate = () => {} } = {}) {
  const abort = new AbortController();
  let state = { size: 1000, index: 0, operation: 'insert', knownPredecessor: false };
  let model = benchmarkModel(state);
  let running = false, finished = false, work = 0, raf = 0, lastTime = 0, duration = 3200;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  container.innerHTML = `
    <section class="ex-benchmark" aria-label="性能对比沙盘">
      <div class="ex-scene-heading"><div><span class="ex-eyebrow">OPERATION COUNTS</span><h1>性能对比沙盘</h1></div><span class="ex-scene-mark">04 / COMPARE</span></div>
      <div class="ex-bench-controls">
        <div class="ex-operation-tabs" aria-label="对比操作">${[['insert','插入'],['delete','删除'],['read','读取'],['update','修改']].map(([v,t])=>`<button data-bench-operation="${v}" class="${v==='insert'?'ex-active':''}" aria-pressed="${v==='insert'}">${t}</button>`).join('')}</div>
        <div class="ex-scale-control"><label for="ex-size-range">数据规模 <strong data-size-label>1,000</strong></label><input id="ex-size-range" data-size-range type="range" min="10" max="10000" step="10" value="1000" aria-label="数据规模"><div class="ex-range-labels"><span>10</span><span>10,000</span></div></div>
        <div class="ex-target-control"><label for="ex-index-number">位置 <code>index</code></label><div class="ex-index-input"><button data-index-step="-1" aria-label="减小下标">−</button><input id="ex-index-number" data-index-number type="number" min="0" max="1000" value="0" aria-label="目标下标"><button data-index-step="1" aria-label="增大下标">+</button></div><div class="ex-position-shortcuts"><button data-position="head" class="ex-active">头部</button><button data-position="middle">中间</button><button data-position="tail">末尾</button></div></div>
        <label class="ex-predecessor-control" data-predecessor-control><span>链表定位</span><select data-predecessor aria-label="链表定位方式"><option value="index">按下标查找</option><option value="known">已持有前驱</option></select></label>
      </div>
      <div class="ex-comparison-grid">
        ${panelMarkup('array','顺序表','ARRAY','连续存储')}
        ${panelMarkup('list','单链表','LINKED LIST','链式存储')}
      </div>
      <div class="ex-bench-bottom"><div class="ex-bench-result" data-bench-result aria-live="polite"><span class="ex-result-dot"></span><span>元素移动 · 数据访问 · 指针操作</span></div><div class="ex-bench-actions"><button class="ex-reset" data-bench-reset aria-label="重置对比">${iconReset}<span>重置</span></button><button class="ex-run" data-bench-run>${iconPlay}<span>运行对比</span></button></div></div>
    </section>`;
  const root = container.querySelector('.ex-benchmark');
  const els = {
    sizeLabel: root.querySelector('[data-size-label]'), sizeRange: root.querySelector('[data-size-range]'),
    index: root.querySelector('[data-index-number]'), predecessor: root.querySelector('[data-predecessor]'),
    predecessorControl: root.querySelector('[data-predecessor-control]'), run: root.querySelector('[data-bench-run]'),
    result: root.querySelector('[data-bench-result]'),
  };
  const panels = {};
  for (const key of ['array','list']) {
    const el = root.querySelector(`[data-bench-panel="${key}"]`);
    panels[key] = { root: el, canvas: el.querySelector('canvas'), count: el.querySelector('[data-count]'), total: el.querySelector('[data-total]'), formula: el.querySelector('[data-formula]'), complexity: el.querySelector('[data-complexity]'), progress: el.querySelector('[data-progress]'), fill: el.querySelector('[data-progress-fill]'), status: el.querySelector('[data-run-status]'), parts: el.querySelector('[data-parts]'), grouping: el.querySelector('[data-grouping]') };
    panels[key].ctx = panels[key].canvas.getContext('2d');
  }
  function maxWork() { return Math.max(model.array.total, model.list.total, 1); }
  function setRunButton() { els.run.innerHTML = running ? `${iconPause}<span>暂停</span>` : `${iconPlay}<span>${finished ? '再次运行' : work > 0 ? '继续' : '运行对比'}</span>`; }
  function syncModel() {
    model = benchmarkModel(state);
    state.size = model.n; state.index = model.i;
    els.sizeLabel.textContent = number(model.n);
    els.sizeRange.value = String(model.n);
    els.index.value = String(model.i);
    els.index.max = String(state.operation === 'insert' ? model.n : model.n-1);
    els.predecessorControl.classList.toggle('ex-hidden-control', !['insert','delete'].includes(state.operation));
    els.predecessor.disabled = !['insert','delete'].includes(state.operation);
    root.querySelectorAll('[data-position]').forEach(el=> {
      const i = el.dataset.position === 'head' ? 0 : el.dataset.position === 'tail' ? Number(els.index.max) : Math.floor(model.n/2);
      el.classList.toggle('ex-active', model.i === i);
    });
    for (const key of ['array','list']) {
      const p = panels[key], m = model[key];
      p.total.textContent = number(m.total);
      p.formula.textContent = m.formula;
      p.complexity.textContent = m.complexity;
      p.progress.setAttribute('aria-valuemax', String(Math.max(m.total,1)));
      p.grouping.textContent = model.n > 1000 ? `1 格 ≈ ${Number((model.n/1000).toFixed(2))} 个元素` : `${number(model.n)} 个元素`;
      p.parts.innerHTML = m.parts.map((part,i)=>`<div><span>${part.label}</span><strong data-part="${i}">0<span> / ${number(part.count)}</span></strong></div>`).join('');
      p.canvas.setAttribute('aria-label', `${key==='array'?'顺序表':'单链表'}操作动画，${model.n} 个元素，目标下标 ${model.i}`);
    }
    duration = reduced ? 250 : 1300 + Math.log10(Math.max(10,maxWork())) * 680;
    render();
  }
  function reset() {
    running = false; finished = false; work = 0; lastTime = 0;
    cancelAnimationFrame(raf);
    els.result.innerHTML = '<span class="ex-result-dot"></span><span>元素移动 · 数据访问 · 指针操作</span>';
    setRunButton(); render();
  }
  function change() { reset(); syncModel(); }
  function start() {
    if (running) { running=false; cancelAnimationFrame(raf); setRunButton(); render(); return; }
    if (finished) reset();
    running = true; lastTime = 0; setRunButton();
    raf = requestAnimationFrame(tick);
  }
  function tick(time) {
    if (!running) return;
    if (lastTime) work = Math.min(maxWork(), work + (time-lastTime)/duration*maxWork());
    lastTime = time;
    if (work >= maxWork()) {
      running = false; finished = true;
      const a = model.array.total, l = model.list.total;
      const ratioText = a===l ? '操作次数相同' : `${a < l ? '顺序表' : '单链表'}少 ${number(Math.abs(a-l))} 次`;
      els.result.innerHTML = `<span class="ex-result-dot ex-complete"></span><span>顺序表 <b>${number(a)}</b> 次<span class="ex-result-divider">/</span>单链表 <b>${number(l)}</b> 次</span><span class="ex-ratio">${ratioText}</span>`;
      setRunButton(); render(); return;
    }
    render(); raf=requestAnimationFrame(tick);
  }
  function render() {
    for (const key of ['array','list']) {
      const p=panels[key], m=model[key], count=Math.min(m.total,Math.floor(work)), hasStarted=running||work>0||finished;
      p.count.textContent=number(count);
      const progress = m.total ? Math.min(work,m.total)/m.total : (hasStarted ? 1 : 0);
      p.fill.style.transform=`scaleX(${progress})`;
      p.progress.setAttribute('aria-valuenow',String(m.total ? count : hasStarted ? 1 : 0));
      const done=hasStarted && count>=m.total;
      p.status.textContent=done?'完成':running?'运行中':work>0?'已暂停':'待运行';
      p.status.classList.toggle('ex-done',done);
      let left=count;
      m.parts.forEach((part,i)=>{
        const el=p.parts.querySelector(`[data-part="${i}"]`);
        if(el) el.innerHTML=`${number(Math.min(part.count,left))}<span> / ${number(part.count)}</span>`;
        left=Math.max(0,left-part.count);
      });
      drawMemory(p, key, model, count, hasStarted, work);
    }
  }
  root.addEventListener('click', event=> {
    const operation=event.target.closest('[data-bench-operation]');
    if(operation) {
      const prev=state.operation; state.operation=operation.dataset.benchOperation;
      if(['read','update'].includes(state.operation)&&['insert','delete'].includes(prev)&&state.index===0)state.index=Math.floor(state.size/2);
      root.querySelectorAll('[data-bench-operation]').forEach(el=>{const selected=el===operation;el.classList.toggle('ex-active',selected);el.setAttribute('aria-pressed',String(selected));});
      change(); return;
    }
    if(event.target.closest('[data-bench-run]')) {start();return;}
    if(event.target.closest('[data-bench-reset]')) {reset();return;}
    const pos=event.target.closest('[data-position]');
    if(pos){state.index=pos.dataset.position==='head'?0:pos.dataset.position==='tail'?(state.operation==='insert'?state.size:state.size-1):Math.floor(state.size/2);change();return;}
    const step=event.target.closest('[data-index-step]');
    if(step){state.index+=Number(step.dataset.indexStep);change();}
  },{signal:abort.signal});
  els.sizeRange.addEventListener('input',()=>{state.size=Number(els.sizeRange.value);state.index=Math.min(state.index,state.operation==='insert'?state.size:state.size-1);change();},{signal:abort.signal});
  const updateIndex=()=>{if(els.index.value==='')return;state.index=Number(els.index.value);change();};
  els.index.addEventListener('input',updateIndex,{signal:abort.signal});
  els.index.addEventListener('change',updateIndex,{signal:abort.signal});
  els.predecessor.addEventListener('change',()=>{state.knownPredecessor=els.predecessor.value==='known';change();},{signal:abort.signal});
  let resizeFrame=0;
  const observer=new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(render);});
  for(const p of Object.values(panels))observer.observe(p.canvas);
  syncModel();
  return ()=>{abort.abort();cancelAnimationFrame(raf);cancelAnimationFrame(resizeFrame);observer.disconnect();};
}

function panelMarkup(key, title, english, subtitle) {
  return `<article class="ex-bench-panel ex-${key}-panel" data-bench-panel="${key}"><div class="ex-panel-heading"><div><span class="ex-eyebrow">${english}</span><h3>${title}<span>${subtitle}</span></h3></div><span class="ex-complexity" data-complexity>O(n)</span></div><div class="ex-memory-wrap"><div class="ex-memory-caption"><span data-grouping>1,000 个元素</span><span class="ex-run-status" data-run-status>待运行</span></div><canvas class="ex-memory-canvas" width="800" height="340" role="img" aria-label="${title}操作动画"></canvas></div><div class="ex-count-row"><div><strong class="ex-main-count" data-count>0</strong><span class="ex-count-unit">次操作</span></div><span class="ex-total-count">共 <b data-total>0</b> 次</span></div><div class="ex-progress" data-progress role="progressbar" aria-label="${title}演示进度" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"><div data-progress-fill></div></div><div class="ex-stat-parts" data-parts></div><div class="ex-formula"><span>操作次数</span><code data-formula></code></div></article>`;
}

function roundRect(ctx,x,y,w,h,r) {
  r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
}

function drawMemory(panel,key,model,count,hasStarted,work) {
  const {canvas,ctx}=panel;
  if(!ctx)return;
  const bounds=canvas.getBoundingClientRect(),width=Math.max(100,bounds.width),height=Math.max(100,bounds.height),dpr=Math.min(window.devicePixelRatio||1,2);
  if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const n=model.n, sample=Math.min(n,1000),padding=5,availableW=width-padding*2,availableH=height-padding*2;
  const cols=Math.min(sample,Math.ceil(Math.sqrt(sample*availableW/availableH))),rows=Math.ceil(sample/cols),cellW=availableW/cols,cellH=availableH/rows;
  const gap=Math.min(5,Math.max(2,cellW*.18)),cw=Math.max(1,cellW-gap),ch=Math.min(28,Math.max(2,cellH-gap));
  const totalH=rows*(ch+gap)-gap,startY=(height-totalH)/2;
  const base=key==='array'?'#dce4ec':'#d4e5df',bright=key==='array'?'#7391ab':'#58a38c',active=key==='array'?'#3f6688':'#168875', target='#d7a650';
  const targetSample=Math.min(sample-1,Math.floor(model.i/n*sample));
  const mutation=['insert','delete'].includes(model.operation);
  const linkedVisits=mutation?(model.knownPredecessor?0:model.i):model.i;
  const traversed=key==='list'?Math.min(linkedVisits,count):0;
  const done=hasStarted&&count>=model[key].total;
  const at=index=>{const row=Math.floor(index/cols),col=key==='list'&&row%2?cols-1-index%cols:index%cols;return {x:padding+col*cellW+(cellW-cw)/2,y:startY+row*(ch+gap)};};
  if(key==='list'&&sample<=100){
    ctx.strokeStyle='#bad5cc';ctx.lineWidth=1;
    for(let j=1;j<sample;j++){const a=at(j-1),b=at(j);ctx.beginPath();ctx.moveTo(a.x+cw/2,a.y+ch/2);ctx.lineTo(b.x+cw/2,b.y+ch/2);ctx.stroke();}
  }
  for(let j=0;j<sample;j++){
    const logical=Math.min(n-1,Math.floor(j*n/sample));
    let color=base,focus=false;
    if(hasStarted){
      if(key==='array'){
        if(model.operation==='insert'){
          const moved=Math.min(n-model.i,count);
          if(logical>=Math.max(model.i,n-moved))color=bright;
          if(j===Math.floor(Math.max(model.i,n-moved)/n*sample)&&moved>0&&!done)focus=true;
          if(done&&j===targetSample){color=active;focus=true;}
        }else if(model.operation==='delete'){
          if(logical>model.i&&logical<=model.i+count)color=bright;
          if(j===targetSample&&count===0)color='#d88c82';
          if(j===Math.floor(Math.min(n-1,model.i+count)/n*sample)&&!done)focus=true;
          if(done&&j===sample-1)color='#edf1f3';
        }else if(j===targetSample){color=active;focus=true;}
      }else{
        if(!model.knownPredecessor||!mutation){if(logical<traversed)color=bright;}
        if(j===Math.floor(Math.min(model.i,traversed)/n*sample)&&!done)focus=true;
        if(done&&(j===targetSample||(mutation&&j===Math.max(0,targetSample-1)))){color=active;focus=true;}
      }
    }else if(j===targetSample)color=target;
    const p=at(j);
    if(focus){ctx.shadowColor=active+'55';ctx.shadowBlur=7;}
    ctx.fillStyle=focus?active:color;
    const lift=key==='array'&&model.operation==='insert'&&focus&&!done?Math.sin((work%1)*Math.PI)*2:0;
    roundRect(ctx,p.x,p.y-lift,cw,ch,Math.min(3,ch*.28));ctx.fill();ctx.shadowBlur=0;
    if(sample<=24){ctx.fillStyle=focus?'#fff':'#476270';ctx.font=`500 ${Math.min(12,ch*.48)}px ui-monospace,monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(logical),p.x+cw/2,p.y+ch/2);}
  }
}




const icons = {
  array:'<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M9 6v12M15 6v12"/>',
  nodes:'<rect x="2" y="4" width="6" height="6" rx="1.5"/><rect x="16" y="14" width="6" height="6" rx="1.5"/><path d="M8 7h8v7m-3-3 3 3 3-3"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
  chart:'<path d="M4 3v17h17M8 15v-3M13 15V7M18 15v-5"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="2" fill="currentColor" stroke="none"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  edit:'<path d="m15 5 4 4M4 20l4-1 12-12-4-4L4 15Z"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron:'<path d="m7 9 5 5 5-5"/>',
  reset:'<path d="M3 9a9 9 0 1 1 1 9M3 3v6h6"/>',
  previous:'<path d="M6 5v14m12-14-9 7 9 7Z"/>',
  next:'<path d="M18 5v14M6 5l9 7-9 7Z"/>',
  play:'<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  pause:'<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  shuffle:'<path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2.5 0 4.2-3 6-6s3.5-6 6-6h3m-4-4 4 4-4 4"/>',
  code:'<path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  volume:'<path d="m11 4-5 4H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute:'<path d="m11 4-5 4H3v8h3l5 4ZM16 9l6 6m0-6-6 6"/>',
  link:'<path d="m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  layout:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M9 9v11"/>',
};
const icon = name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.array}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
const app=document.querySelector('#app');
const defaults={array:{values:[23,45,12,67],index:1,value:88,operation:'insert',wrongOrder:false},list:{values:[10,20,30,40],index:2,value:25,operation:'insert',wrongOrder:false}};
const configs=structuredClone(defaults);
const names={insert:'插入',delete:'删除',read:'读取',update:'修改'};
let current='array',timeline=null,frameIndex=0,playing=false,timer=0,stage=null,abort=null,extraCleanup=null,speed=1,manual=false,sound=false,audioContext=null,toastTimer=0;
const q=s=>app.querySelector(s);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const syntax=line=>escape(line).replace(/\b(const|let|for|return|new)\b/g,'<span class="tok-key">$1</span>').replace(/\b(\d+)\b/g,'<span class="tok-num">$1</span>').replace(/\b(next|length|null|empty)\b/g,'<span class="tok-name">$1</span>');
function notify(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),1800);}
function tone(kind='step'){
  if(!sound)return;
  try{audioContext ||= new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume();const o=audioContext.createOscillator(),g=audioContext.createGain();o.type='sine';o.frequency.value=kind==='complete'?720:kind==='error'?230:480;g.gain.setValueAtTime(.025,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.07);o.connect(g);g.connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+.08);}catch{}
}
function stop(){playing=false;clearTimeout(timer);if(q('#play')){updatePlay();const f=timeline?.frames[frameIndex];if(q('#state-text')&&f)q('#state-text').textContent=f.error?'逆序实验':f.done?'演示完成':frameIndex?'已暂停':'准备就绪';}}
function navigate(module,writeHash=true){
  if(!['array','list','intro','benchmark'].includes(module))module='array';
  stop();stage?.destroy();stage=null;abort?.abort();extraCleanup?.();extraCleanup=null;current=module;manual=false;
  document.querySelectorAll('[data-module]').forEach(el=>{el.classList.toggle('active',el.dataset.module===module);el.setAttribute('aria-current',el.dataset.module===module?'page':'false');});
  document.querySelector('#keyboard-hints').style.visibility=['array','list'].includes(module)?'visible':'hidden';
  if(writeHash&&location.hash!==`#${module}`)history.replaceState(null,'',`#${module}`);
  app.classList.remove('page-enter');void app.offsetWidth;app.classList.add('page-enter');
  window.scrollTo(0,0);
  if(module==='intro'||module==='benchmark'){
    timeline=null;app.innerHTML='';extraCleanup=(module==='intro'?mountIntro:mountBenchmark)(app,{onNavigate:navigate});return;
  }
  renderWorkspace();
}
function renderWorkspace(){
  const list=current==='list',c=configs[current];
  app.innerHTML=`<div class="page-heading"><div><div class="eyebrow"><span class="number">${list?'02':'01'} /</span>${list?'LINKED STORAGE':'CONTIGUOUS STORAGE'}</div><h1>${list?'单链表实验室':'顺序表工作台'}<span class="heading-chip">${list?'离散存储':'连续存储'}</span></h1></div><button class="heading-next" id="next-module">${list?'性能对比':'探索单链表'} ${icon('arrow')}</button></div>
  <div class="workspace">
    <aside class="control-panel panel" aria-label="操作参数">
      <div class="panel-head"><h2 class="panel-title">${icon('settings')}操作面板</h2><span class="small-kicker">CONTROL</span></div>
      <div class="operation-grid" aria-label="选择操作">${[['insert','plus'],['delete','minus'],['read','search'],['update','edit']].map(([op,ic])=>`<button class="operation-btn ${c.operation===op?'active':''}" data-operation="${op}" aria-pressed="${c.operation===op}">${icon(ic)}${names[op]}</button>`).join('')}</div>
      <div class="field"><label for="index-input" class="field-label">目标下标 <span class="mono">index</span></label><div class="number-field"><button id="index-minus" aria-label="减小目标下标">−</button><input id="index-input" type="number" value="${c.index}" min="0" step="1" inputmode="numeric" aria-label="目标下标"><button id="index-plus" aria-label="增大目标下标">+</button></div></div>
      <div class="field" id="value-field"><label for="value-input" class="field-label">数据值 <span class="mono">value</span></label><input id="value-input" class="value-input" type="number" value="${c.value}" min="-999" max="999" step="1" inputmode="numeric" aria-label="数据值"></div>
      <p id="input-error" class="input-error" role="status"></p>
      <details class="data-editor"><summary><span>初始数据</span><span id="data-summary" class="data-summary">${c.values.length} ELEMENTS</span>${icon('chevron')}</summary><div class="data-editor-body"><input id="data-input" class="data-input" type="text" value="${c.values.join(', ')}" aria-label="初始数据，逗号分隔" placeholder="23, 45, 12, 67"><div class="data-actions"><button class="subtle-button" id="restore-example">${icon('reset')}示例</button><button class="subtle-button apply-data" id="apply-data">应用数据 ${icon('arrow')}</button></div></div></details>
      <button id="random-data" class="random-button">${icon('shuffle')}生成一组数据</button>
      ${list?`<div class="lab-options"><div class="toggle-row"><span>逆序实验</span><button id="wrong-order" class="toggle" role="switch" aria-checked="${c.wrongOrder}" aria-label="逆序实验"></button></div><button id="manual-connect" class="manual-connect" aria-pressed="false">${icon('link')}手动连线</button></div>`:''}
      <div class="side-divider"></div><div class="stats-heading">运行状态</div>
      <div class="stats-grid"><div><div class="stat-label">当前长度</div><div class="stat-value" id="length-stat">${c.values.length}<small>${list?'':'/ 8'}</small></div></div><div><div class="stat-label">${list?'指针修改':'元素移动'}</div><div class="stat-value" id="move-stat">0<small>次</small></div></div><div><div class="stat-label">访问</div><div class="stat-value" id="read-stat">0<small>次</small></div></div><div><div class="stat-label">写入</div><div class="stat-value" id="write-stat">0<small>次</small></div></div></div>
      <div class="complexity-row"><span>时间复杂度</span><strong id="complexity">O(n)</strong></div><button id="continue" class="continue-button" hidden>采用结果，继续操作 ${icon('arrow')}</button>
    </aside>
    <div class="main-column">
      <section class="visual-panel panel" aria-label="算法演示">
        <div class="visual-header"><div class="visual-title">${icon(list?'nodes':'array')}内存视图<span class="visual-subtitle">${list?'LINKED LIST':'SEQUENTIAL LIST'}</span></div><span class="stage-state" id="stage-state"><span class="state-dot"></span><span id="state-text">准备就绪</span></span></div>
        <div class="stage-toolbar"><div class="legend"><span class="legend-item"><i class="legend-dot"></i>已有元素</span><span class="legend-item"><i class="legend-dot active"></i>当前操作</span><span class="legend-item"><i class="legend-dot new"></i>新增元素</span></div><span class="stage-info">${list?'data / next':'CAPACITY 08 · INT32'}</span></div>
        <div class="stage-viewport"><svg id="visual-stage" class="visual-stage"></svg></div>
        <div class="stage-underbar"><span>${list?'NON-CONTIGUOUS ADDRESSES':'BASE 0x1000 · 4 BYTES / ELEMENT'}</span>${list?`<button id="reset-layout" class="memory-toggle">${icon('layout')}整理布局</button>`:`<button id="memory-toggle" class="memory-toggle" aria-pressed="false">${icon('eye')}内存副本</button>`}</div>
        <div class="player"><div class="player-status"><div class="status-left"><span id="step-chip" class="step-chip">00</span><span id="step-status" aria-live="polite"></span></div><span id="status-code" class="status-code"></span></div><div class="playback-row"><div class="transport"><button id="restart" class="icon-button" aria-label="重置演示" title="重置 (R)">${icon('reset')}</button><button id="previous" class="icon-button" aria-label="上一步" title="上一步 (←)">${icon('previous')}</button><button id="play" class="play-button" aria-label="连续演示">${icon('play')}<span>连续演示</span></button><button id="next" class="icon-button" aria-label="下一步" title="下一步 (→)">${icon('next')}</button></div><div class="timeline-control"><input id="timeline" class="range" type="range" min="0" max="5" step="1" value="0" aria-label="演示进度"><span id="frame-count" class="frame-count">00 / 05</span></div><label class="speed-control"><select id="speed" aria-label="播放速度"><option value="0.5">0.5×</option><option value="1" selected>1.0×</option><option value="1.5">1.5×</option><option value="2">2.0×</option></select></label></div></div>
      </section>
      <div class="detail-grid"><section class="code-panel" aria-label="同步代码"><div class="code-header"><span class="code-title">${icon('code')}同步代码</span><span class="code-lang">PSEUDOCODE</span></div><div id="code-body" class="code-body"></div></section><section class="trace-panel panel" aria-label="执行轨迹"><div class="trace-header"><h2>执行轨迹</h2><span id="trace-count" class="trace-count"></span></div><div id="trace-body" class="trace-body"></div></section></div>
    </div>
  </div>`;
  abort=new AbortController();const signal=abort.signal;
  const on=(el,event,fn)=>el?.addEventListener(event,fn,{signal});
  stage=new VisualStage(q('#visual-stage'),{type:current,onConnect:connectManually,onInteraction:stop,onInspect:id=>{const n=timeline?.frames[frameIndex].nodes.find(n=>n.id===id);if(n)notify(`data ${n.value}${n.slot>=0?` · index ${n.slot}`:''}`);}});
  q('#speed').value=speed;
  for(const btn of app.querySelectorAll('[data-operation]'))on(btn,'click',()=>{adoptResult();c.operation=btn.dataset.operation;if(c.operation!=='insert')c.wrongOrder=false;manual=false;rebuild();});
  on(q('#next-module'),'click',()=>navigate(list?'benchmark':'list'));
  const changeIndex=()=>{const raw=q('#index-input').value;if(raw==='')return;const v=Number(raw);if(!Number.isInteger(v)){showError('下标须为整数');return;}c.index=Math.max(0,Math.min(maxIndex(),v));rebuild();};
  on(q('#index-input'),'input',changeIndex);on(q('#index-input'),'change',changeIndex);
  on(q('#index-minus'),'click',()=>{c.index=Math.max(0,c.index-1);rebuild();});on(q('#index-plus'),'click',()=>{c.index=Math.min(maxIndex(),c.index+1);rebuild();});
  const changeValue=()=>{const raw=q('#value-input').value,v=Number(raw);if(raw.trim()==='')return;if(!Number.isInteger(v)||v<-999||v>999){showError('输入 −999 至 999 的整数');return;}c.value=v;rebuild();};
  on(q('#value-input'),'input',changeValue);on(q('#value-input'),'change',changeValue);
  on(q('#apply-data'),'click',applyData);on(q('#data-input'),'keydown',e=>{if(e.key==='Enter')applyData();});
  on(q('#restore-example'),'click',()=>{Object.assign(c,structuredClone(defaults[current]));rebuild();});
  on(q('#random-data'),'click',()=>{c.values=Array.from({length:4+Math.floor(Math.random()*2)},()=>10+Math.floor(Math.random()*80));c.index=Math.min(c.index,c.values.length-1);rebuild();});
  on(q('#restart'),'click',()=>{stop();setFrame(0);});on(q('#previous'),'click',()=>{stop();setFrame(frameIndex-1);});on(q('#next'),'click',()=>{stop();setFrame(frameIndex+1);});on(q('#play'),'click',togglePlay);
  on(q('#timeline'),'input',()=>{stop();setFrame(Number(q('#timeline').value),false);});
  on(q('#speed'),'change',()=>{speed=Number(q('#speed').value);stage.duration=Math.min(560,560/speed);if(playing){clearTimeout(timer);timer=setTimeout(tick,840/speed);}});
  on(q('#continue'),'click',()=>{adoptResult();rebuild();});
  on(q('#memory-toggle'),'click',()=>{const button=q('#memory-toggle'),value=button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(value));stage.setMemory(value);});
  on(q('#reset-layout'),'click',()=>stage.resetLayout());
  on(q('#wrong-order'),'click',()=>{c.wrongOrder=!c.wrongOrder;manual=false;rebuild();});
  on(q('#manual-connect'),'click',()=>{stop();manual=!manual;if(c.wrongOrder){c.wrongOrder=false;rebuild(false);}stage.setManual(manual);q('#manual-connect').setAttribute('aria-pressed',String(manual));if(manual){const i=timeline.frames.findIndex(f=>f.event==='allocate');if(i>=0)setFrame(i);notify('拖动 next 端口，连接目标节点');}});
  on(q('#trace-body'),'click',e=>{const btn=e.target.closest('[data-frame]');if(btn){stop();setFrame(Number(btn.dataset.frame));}});
  rebuild();
}
function maxIndex(){const c=configs[current];return Math.max(0,c.values.length-(c.operation==='insert'?0:1));}
function showError(message){stop();q('#input-error').textContent=message;}
function applyData(){
  const text=q('#data-input').value.trim(),parts=text?text.split(/[\s,，、;；]+/).filter(Boolean):[],values=parts.map(Number);
  if(parts.some(v=>!/^[-+]?\d+$/.test(v))||values.some(v=>!Number.isInteger(v)||v<-999||v>999)){showError('使用逗号分隔 −999 至 999 的整数');return;}
  if(values.length>8){showError('最多 8 个元素');return;}
  const c=configs[current];c.values=values;if(!values.length)c.operation='insert';if(values.length===8&&c.operation==='insert')c.operation='read';c.index=Math.min(c.index,maxIndex());rebuild();
}
function adoptResult(){
  const c=configs[current];if(timeline&&frameIndex===timeline.frames.length-1&&timeline.valid!==false&&c.operation!=='read')c.values=[...timeline.result];
}
function rebuild(resetManual=true){
  stop();if(resetManual)manual=false;const c=configs[current];
  if(!c.values.length)c.operation='insert';if(c.values.length===8&&c.operation==='insert')c.operation='read';
  c.index=Math.max(0,Math.min(maxIndex(),Number.isInteger(c.index)?c.index:0));
  for(const btn of app.querySelectorAll('[data-operation]')){btn.classList.toggle('active',btn.dataset.operation===c.operation);btn.setAttribute('aria-pressed',String(btn.dataset.operation===c.operation));btn.disabled=(!c.values.length&&btn.dataset.operation!=='insert')||(c.values.length===8&&btn.dataset.operation==='insert');}
  q('#index-input').value=c.index;q('#index-input').max=maxIndex();q('#index-minus').disabled=c.index===0;q('#index-plus').disabled=c.index===maxIndex();q('#value-input').value=c.value;
  q('#value-field').classList.toggle('is-hidden',!['insert','update'].includes(c.operation));q('#input-error').textContent='';q('#data-input').value=c.values.join(', ');q('#data-summary').textContent=`${c.values.length} ELEMENTS`;
  if(current==='list'){q('#wrong-order').disabled=c.operation!=='insert';q('#wrong-order').setAttribute('aria-checked',String(c.wrongOrder&&c.operation==='insert'));q('#manual-connect').disabled=c.operation!=='insert';q('#manual-connect').setAttribute('aria-pressed',String(manual));}
  try{timeline=(current==='array'?buildArrayTimeline:buildListTimeline)(c);}catch(e){showError(e.message);return;}
  frameIndex=0;stage.duration=Math.min(560,560/speed);stage.setTimeline(timeline,c.index);stage.setManual(manual);
  q('#code-body').innerHTML=timeline.code.map((line,i)=>`<div class="code-line" data-code-line="${i}"><span class="line-number">${i+1}</span><span class="line-text">${syntax(line)}</span></div>`).join('');
  q('#trace-body').innerHTML=timeline.frames.map((f,i)=>`<button class="trace-item" data-frame="${i}"><span class="trace-index">${String(i).padStart(2,'0')}</span><span>${escape(f.status)}</span><span class="trace-check"></span></button>`).join('');
  q('#trace-count').textContent=`${timeline.frames.length-1} STEPS`;q('#complexity').textContent=timeline.complexity;
  q('#timeline').max=timeline.frames.length-1;setFrame(0,false);
}
function setFrame(index,animate=true){
  if(!timeline)return;const next=Math.max(0,Math.min(timeline.frames.length-1,index));const changed=next!==frameIndex;frameIndex=next;const frame=timeline.frames[frameIndex],c=configs[current];stage.setFrame(frame,animate);
  q('#step-chip').textContent=String(frameIndex).padStart(2,'0');q('#step-status').textContent=frame.status;q('#status-code').textContent=`${current==='array'?'A':'LIST'}[${c.index}]${['insert','update'].includes(c.operation)?` ← ${c.value}`:''}`;
  q('#length-stat').innerHTML=`${frame.metrics.length}<small>${current==='array'?'/ 8':''}</small>`;q('#move-stat').innerHTML=`${current==='array'?frame.metrics.moves:frame.metrics.pointerWrites}<small>次</small>`;
  q('#read-stat').innerHTML=`${frame.metrics.reads}<small>次</small>`;q('#write-stat').innerHTML=`${frame.metrics.writes}<small>次</small>`;
  q('#timeline').value=frameIndex;q('#timeline').style.setProperty('--progress',`${100*frameIndex/(timeline.frames.length-1)}%`);
  q('#frame-count').textContent=`${String(frameIndex).padStart(2,'0')} / ${String(timeline.frames.length-1).padStart(2,'0')}`;
  q('#previous').disabled=frameIndex===0;q('#next').disabled=frameIndex===timeline.frames.length-1;
  q('#continue').hidden=!frame.done||timeline.valid===false||c.operation==='read';
  for(const el of app.querySelectorAll('[data-code-line]'))el.classList.toggle('active',Number(el.dataset.codeLine)===frame.codeLine);
  const activeCode=q('.code-line.active');if(activeCode){const body=q('#code-body');if(activeCode.offsetTop-body.offsetTop>body.scrollTop+body.clientHeight-30)body.scrollTop=activeCode.offsetTop-body.offsetTop-body.clientHeight+35;}
  for(const el of app.querySelectorAll('[data-frame]')){const i=Number(el.dataset.frame);el.classList.toggle('active',i===frameIndex);el.classList.toggle('past',i<frameIndex);el.querySelector('.trace-check').textContent=i<frameIndex?'✓':i===frameIndex?'←':'';}
  const trace=q(`[data-frame="${frameIndex}"]`),body=q('#trace-body');if(trace){const top=trace.offsetTop-body.offsetTop;if(top<body.scrollTop||top+trace.offsetHeight>body.scrollTop+body.clientHeight)body.scrollTop=Math.max(0,top-50);}
  q('#stage-state').classList.toggle('error',Boolean(frame.error));q('#state-text').textContent=frame.error?'逆序实验':frame.done?'演示完成':playing?'正在执行':frameIndex?'已暂停':'准备就绪';
  if(changed&&animate)tone(frame.error?'error':frame.done?'complete':'step');updatePlay();
}
function updatePlay(){const button=q('#play');if(!button)return;button.innerHTML=icon(playing?'pause':'play')+`<span>${playing?'暂停演示':frameIndex===timeline?.frames.length-1?'重新播放':'连续演示'}</span>`;button.setAttribute('aria-label',playing?'暂停演示':'连续演示');q('#stage-state')?.classList.toggle('running',playing);}
function tick(){if(!playing||!timeline)return;if(frameIndex>=timeline.frames.length-1){stop();return;}setFrame(frameIndex+1);if(frameIndex===timeline.frames.length-1){stop();return;}timer=setTimeout(tick,840/speed);}
function togglePlay(){if(!timeline)return;if(playing){stop();setFrame(frameIndex,false);return;}if(frameIndex===timeline.frames.length-1)setFrame(0,false);playing=true;updatePlay();tick();}
function connectManually(from,to){
  if(current!=='list'||configs.list.operation!=='insert')return;
  stop();const c=configs.list,prev=c.index===0?'head':`n${c.index-1}`,successor=c.index<c.values.length?`n${c.index}`:null;
  const connectIdx=timeline.frames.findIndex(f=>f.event==='connect-successor');
  if(from==='new'&&to===successor){
    if(c.wrongOrder){c.wrongOrder=false;rebuild(false);}manual=true;stage.setManual(true);q('#manual-connect').setAttribute('aria-pressed','true');setFrame(timeline.frames.findIndex(f=>f.event==='connect-successor'));notify('后继已连接');
  }else if(from===prev&&to==='new'){
    if(!c.wrongOrder&&frameIndex>=connectIdx&&connectIdx>=0){setFrame(timeline.frames.findIndex(f=>f.event==='connect-predecessor'));timer=setTimeout(()=>{if(current==='list'&&timeline?.valid!==false)setFrame(timeline.frames.length-1);},660);}
    else {c.wrongOrder=true;rebuild(false);manual=true;stage.setManual(true);q('#manual-connect').setAttribute('aria-pressed','true');setFrame(timeline.frames.findIndex(f=>f.event==='disconnect'));}
  }else if(c.wrongOrder&&from==='new'&&to==='new'){setFrame(timeline.frames.length-1);}
  else {notify(`连接 ${from==='new'?(successor===null?'null':c.values[c.index]):'新节点'}`);}
}

document.querySelectorAll('[data-module]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.module)));
document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();navigate('array');});
document.querySelector('#sound-toggle').innerHTML=icon('mute');document.querySelector('#fullscreen-toggle').innerHTML=icon('expand');
document.querySelector('#sound-toggle').addEventListener('click',()=>{sound=!sound;const b=document.querySelector('#sound-toggle');b.setAttribute('aria-pressed',String(sound));b.setAttribute('aria-label',sound?'关闭交互音效':'开启交互音效');b.innerHTML=icon(sound?'volume':'mute');tone();});
document.querySelector('#fullscreen-toggle').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('可使用浏览器全屏');}});
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1),false));
document.addEventListener('keydown',e=>{
  if(!timeline||e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||/INPUT|SELECT|TEXTAREA|SUMMARY|A/.test(document.activeElement?.tagName)||document.activeElement?.closest('.visual-stage'))return;
  if(e.code==='Space'&&document.activeElement?.tagName==='BUTTON')return;
  if(e.code==='Space'){e.preventDefault();togglePlay();}else if(e.key==='ArrowRight'){e.preventDefault();stop();setFrame(frameIndex+1);}else if(e.key==='ArrowLeft'){e.preventDefault();stop();setFrame(frameIndex-1);}else if(e.key.toLowerCase()==='r'){stop();setFrame(0);}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
navigate(location.hash.slice(1)||'array',false);

})();
