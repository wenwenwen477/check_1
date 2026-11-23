// 调查问卷逻辑：多语言（中文/日文/英文/繁体）、条件题目（按前一题答案出现）、记录全部所选选项。
// 纯问卷 + 评分器：不做结局判定，不写分析文案。中文数据全在 story.js，其余语言在 i18n.js。
(function(){
  'use strict';
  var S = window.STORY;
  if(!S) return;

  var SAVE_KEY = 'bi_survey_v1'; // 整份答案存本地：qN / answers 对象 / total / 时间
  var LANG_KEY = 'bi_survey_lang';
  var qi = 0;                    // 当前题在「实际出现题目」中的下标
  var answers = {};              // { 题目id: 选项序号 }
  var picked = false;
  var blackoutTimer = null;
  var blackoutReadyAt = 0;
  var lang = 'zh';               // 默认中文

  function $(id){ return document.getElementById(id); }

  // 当前语言的 meta 字段 / 题目文案；中文没有 i18n 包，直接读 STORY 原文
  function pack(){ return (lang !== 'zh' && window.I18N && window.I18N[lang]) || null; }
  function M(key){
    var p = pack();
    return (p && p.meta && p.meta[key] != null) ? p.meta[key] : S.meta[key];
  }
  function Q(id){
    var p = pack();
    return (p && p.q && p.q[id]) || null;
  }
  // 自由输入题的内容作为变量：varName 是变量名，题干里的 {name} 会被替换成玩家输入
  // 选项题也能当变量：数字答案取当前语言的选项文本；输入框题取字符串
  function varValue(q){
    var v = answers[q.id];
    if(v == null) return '';
    if(typeof v === 'string') return v.trim();
    if(typeof v === 'number'){
      var opts = qOptions(q);
      return opts && opts[v] != null ? opts[v] : '';
    }
    return '';
  }
  function applyVars(text){
    if(typeof text !== 'string') return text;
    S.questions.forEach(function(q){
      if(!q.varName) return;
      var v = varValue(q);
      if(v !== '') text = text.split('{' + q.varName + '}').join(v);
    });
    return text;
  }
  window.surveyVar = function(name){
    for(var i=0;i<S.questions.length;i++){
      var q = S.questions[i];
      if(q.varName === name) return answers[q.id] != null ? answers[q.id] : '';
    }
    return '';
  };
  // 条件题干：textIf = [{ showIf:{q:'q4a',in:[0]}, text:'…' }]，命中第一条就覆盖默认题干
  function qText(q){
    var t = Q(q.id);
    var text = t && t.text != null ? t.text : q.text;
    var variants = (t && t.textIf) || q.textIf;
    if(variants){
      for(var i=0;i<variants.length;i++){
        var v = variants[i];
        var conds = Array.isArray(v.showIf) ? v.showIf : [v.showIf];
        if(conds.some(condMatch)){
          text = v.text;
          break;
        }
      }
    }
    return applyVars(text);
  }
  function qOptions(q){ var t = Q(q.id); return t && t.options ? t.options : q.options; }
  function qPlaceholder(q){ var t = Q(q.id); return (t && t.placeholder != null) ? t.placeholder : (q.placeholder || ''); }
  function qEn(q){ var t = Q(q.id); return t && t.en != null ? t.en : (q.en || ''); }

  function loadRec(){
    try{ return JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') || {}; }
    catch(e){ return {}; }
  }
  // 统一条件判断：in = 答案序号命中；notEmpty = 输入框填过内容。
  // showIf / skipIf / textIf 共用，新增条件类型只改这里。
  function condMatch(c){
    if(!c) return false;
    if(c.in) return c.in.indexOf(answers[c.q]) !== -1;
    if(c.notEmpty) return typeof answers[c.q] === 'string' && answers[c.q].trim() !== '';
    return false;
  }

  function saveAnswer(q, val){
    var rec = loadRec();
    rec[q.id] = val;                    // q1..q6 / q3b / q3c / q3d
    rec.answers = Object.assign({}, answers);
    rec.total = visible().length;
    rec.updatedAt = new Date().toISOString();
    try{ localStorage.setItem(SAVE_KEY, JSON.stringify(rec)); }catch(e){}
  }

  // 条件题：showIf = { q:'q3b', in:[1,2] }，只有那题选了指定序号才出现
  function visible(){
    return S.questions.filter(function(q){
      if(q.showIf){
        // showIf 可以是单个条件，也可以是条件数组（任一命中即出现，用于分支汇合）
        var conds = Array.isArray(q.showIf) ? q.showIf : [q.showIf];
        if(!conds.some(condMatch)) return false;
      }
      // skipIf：命中就不出现；notEmpty 用于「玩家自己填过内容」这类条件
      if(q.skipIf){
        var skips = Array.isArray(q.skipIf) ? q.skipIf : [q.skipIf];
        if(skips.some(condMatch)) return false;
      }
      return true;
    });
  }

  function show(name){
    ['intro','quiz','result','thanks'].forEach(function(n){ $(n).classList.toggle('hidden', n!==name); });
    if($('blackout')) $('blackout').classList.toggle('hidden', name!=='blackout');
    if($('storyBlackout')) $('storyBlackout').classList.toggle('hidden', name!=='storyBlackout');
    window.scrollTo(0,0);
  }

  // 感谢页双人对谈：who='a' 斐可悉靠左，who='b' 吻梦靠右
  function renderChat(){
    var box = $('chat');
    if(!box) return;
    box.innerHTML = '';
    var lines = M('dialogue') || [];
    var avatars = { a:'乌鸦.png', b:'影中人.png' };
    var names = { a:M('credit1Name'), b:M('credit2Name') };
    lines.forEach(function(line){
      var row = document.createElement('div');
      row.className = 'chat-row ' + (line.who === 'b' ? 'right' : 'left');
      var av = document.createElement('img');
      av.className = 'chat-avatar';
      av.src = avatars[line.who];
      av.alt = names[line.who] || '';
      var bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      var nm = document.createElement('div');
      nm.className = 'chat-name';
      nm.textContent = names[line.who] || '';
      var tx = document.createElement('div');
      tx.textContent = line.text;
      bubble.appendChild(nm); bubble.appendChild(tx);
      row.appendChild(av); row.appendChild(bubble);
      box.appendChild(row);
    });
  }

  var LIKE_KEY = 'bi_survey_likes';
  function loadLikes(){
    try{ var n = parseInt(localStorage.getItem(LIKE_KEY), 10); return isNaN(n) ? 0 : n; }
    catch(e){ return 0; }
  }
  function renderLikes(){
    var n = loadLikes();
    if($('likeNum')) $('likeNum').textContent = n;
    if($('likeBtn')) $('likeBtn').setAttribute('aria-label', M('likeLabel') + ' ' + n);
  }
  function doLike(){
    var n = loadLikes() + 1;
    try{ localStorage.setItem(LIKE_KEY, String(n)); }catch(e){}
    renderLikes();
    var btn = $('likeBtn');
    if(!btn) return;
    // 按钮弹一下
    btn.classList.remove('liked');
    void btn.offsetWidth;
    btn.classList.add('liked');
    // 飘心特效
    for(var i=0;i<5;i++){
      (function(k){
        var h = document.createElement('span');
        h.className = 'like-float';
        h.textContent = '♥';
        h.style.left = (btn.offsetLeft + btn.offsetWidth/2 - 8 + (Math.random()*40-20)) + 'px';
        h.style.top = (btn.offsetTop) + 'px';
        h.style.animationDelay = (k*70) + 'ms';
        h.style.color = k%2 ? '#e05a7a' : '#ff8fa8';
        (btn.parentNode).appendChild(h);
        setTimeout(function(){ if(h.parentNode) h.parentNode.removeChild(h); }, 1200);
      })(i);
    }
  }

  function renderStatic(){
    document.documentElement.lang = ({zh:'zh-CN',ja:'ja','zh-TW':'zh-TW',en:'en'})[lang] || 'zh-CN';
    document.title = M('title');
    $('org').textContent = M('org');
    $('title').textContent = M('title');
    $('subtitle').textContent = M('subtitle');
    $('sourceNote').textContent = M('sourceNote');
    $('warning').textContent = M('warning');
    $('blackoutMain').textContent = M('blackout');
    $('blackoutEn').textContent = M('blackoutEn');
    $('introLead').textContent = M('introLead');
    $('introBody').textContent = M('introBody');
    $('introBody').classList.toggle('hidden', !M('introBody'));
    $('docLabel').textContent = M('docLabel');
    $('startBtn').textContent = M('acknowledge');
    $('nextBtn').textContent = M('next');
    $('restartBtn').textContent = M('restart');
    $('foot').textContent = M('footer');
    $('resultLabel').textContent = M('resultLabel');
    $('resultHeading').textContent = M('recordHeading');
    $('thanksTitle').textContent = M('thanks');
    $('credit1Name').textContent = M('credit1Name');
    $('credit1Role').textContent = M('credit1Role');
    $('credit2Name').textContent = M('credit2Name');
    $('credit2Role').textContent = M('credit2Role');
    $('thanksRestartBtn').textContent = M('restart');
    renderChat();
    renderLikes();
    if($('langSel')) $('langSel').value = lang;
  }

  function renderQuestion(){
    var list = visible();
    if(qi >= list.length) qi = list.length - 1;
    if(qi < 0) qi = 0;
    var q = list[qi];

    var opts = qOptions(q);

    // 黑屏白字叙事题：铺满黑屏，点/回车继续，不计答案、不显示下一题按钮
    if(q.kind === 'blackout'){
      $('storyBlackoutText').textContent = qText(q);
      $('storyBlackoutEn').textContent = qEn(q);
      picked = true;
      $('nextBtn').classList.add('hidden');
      show('storyBlackout');
      return;
    }

    $('qText').textContent = qText(q);
    $('quiz').classList.toggle('blank-q', qText(q) === '');

    // 自由输入题：隐藏选项、显示输入框；内容非空才能继续
    var isInput = q.kind === 'input';
    $('options').classList.toggle('hidden', isInput);
    $('textInput').classList.toggle('hidden', !isInput);
    if(isInput){
      var inp = $('freeInput');
      inp.value = typeof answers[q.id] === 'string' ? answers[q.id] : '';
      inp.placeholder = qPlaceholder(q);
      picked = inp.value.trim() !== '';
      $('nextBtn').classList.toggle('hidden', !picked);
      $('nextBtn').textContent = M('next');
      return;
    }

    var box = $('options');
    box.innerHTML = '';
    opts.forEach(function(opt, i){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'option' + (answers[q.id]===i ? ' selected' : '');
      var mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = String.fromCharCode(65+i);
      var label = document.createElement('span');
      label.textContent = opt;
      b.appendChild(mark); b.appendChild(label);
      b.addEventListener('click', function(){ choose(q, i); });
      box.appendChild(b);
    });

    // 无选项的陈述题直接放行，只显示「下一题」
    picked = opts.length === 0 || answers[q.id] != null;
    $('nextBtn').classList.toggle('hidden', !picked);
    $('nextBtn').textContent = M('next');
  }

  function choose(q, i){
    // 改选本题时，按数据里的 clears 列表丢掉后续分支的旧记录
    var was = answers[q.id];
    if(was !== i && q.clears){
      q.clears.forEach(function(id){ delete answers[id]; });
    }
    answers[q.id] = i;
    picked = true;
    saveAnswer(q, i);           // 每题每个选项都留下记录
    renderQuestion();
  }

  function next(){
    // 离开输入题前把输入框内容写入答案（同时就是变量 device 的值）
    var cur = visible()[qi];
    if(cur && cur.kind === 'input' && $('freeInput') && !$('textInput').classList.contains('hidden')){
      var typed = $('freeInput').value.trim();
      if(typed === '') return;
      var wasTyped = answers[cur.id];
      answers[cur.id] = typed;
      if(wasTyped !== typed) saveAnswer(cur, typed);
      picked = true;
    }
    if(!picked) return;
    var list = visible();
    var fromBlackout = !$('storyBlackout').classList.contains('hidden');
    if(qi < list.length-1){
      qi++;
      renderQuestion();
      if(fromBlackout && list[qi].kind !== 'blackout') show('quiz');
    }
    else {
      if(list[qi].endView === 'thanks') show('thanks');
      else showResult();
    }
  }

  // 评分器：逐题回显所选选项 + 统计。 analyses 有内容时才附加显示分析。
  function renderResult(){
    var log = $('answerLog');
    log.innerHTML = '';
    var yes = 0, no = 0, n = 0;
    visible().forEach(function(q, i){
      var val = answers[q.id];
      var opts = qOptions(q);
      n++;
      if(opts.length === 2){ if(val === 0) yes++; else if(val === 1) no++; }
      var row = document.createElement('div');
      row.className = 'log-row';
      var left = document.createElement('div');
      left.className = 'log-left';
      var noEl = document.createElement('span');
      noEl.className = 'log-no';
      noEl.textContent = String(i+1).padStart(2,'0');
      var qt = document.createElement('span');
      qt.className = 'log-q';
      qt.textContent = qText(q);
      left.appendChild(noEl); left.appendChild(qt);
      var ans = document.createElement('span');
      ans.className = 'log-ans' + (val===1 ? ' no' : '');
      ans.textContent = (val==null) ? '—' : (q.kind === 'input' ? val : opts[val]);
      row.appendChild(left); row.appendChild(ans);
      var a = S.analyses && S.analyses[q.id];
      if(a){
        var an = document.createElement('div');
        an.className = 'log-analysis';
        an.textContent = a;
        row.appendChild(an);
      }
      log.appendChild(row);
    });
    $('summaryLine').textContent = M('summary')
      .replace('{n}', n).replace('{y}', yes).replace('{no}', no);
  }
  function showResult(){ renderResult(); show('result'); }

  function restart(){ window.location.reload(); }

  // 「我已知晓」→ 全黑过场，约 3.6 秒后自动进问卷；点击/回车可提前跳过
  function beginQuiz(){
    if(blackoutTimer){ clearTimeout(blackoutTimer); blackoutTimer = null; }
    qi = 0; answers = {}; picked = false;
    renderQuestion(); show('quiz');
  }
  function enterBlackout(){
    show('blackout');
    blackoutReadyAt = Date.now() + 500;
    blackoutTimer = setTimeout(beginQuiz, 3600);
  }

  $('startBtn').addEventListener('click', enterBlackout);
  $('blackout').addEventListener('click', function(){
    if(Date.now() >= blackoutReadyAt) beginQuiz();
  });
  $('blackout').addEventListener('keydown', function(e){
    if((e.key==='Enter'||e.key===' ') && Date.now() >= blackoutReadyAt){
      e.preventDefault(); beginQuiz();
    }
  });
  $('nextBtn').addEventListener('click', next);
  if($('freeInput')){
    $('freeInput').addEventListener('input', function(){
      var q = visible()[qi];
      if(!q || q.kind !== 'input') return;
      picked = $('freeInput').value.trim() !== '';
      $('nextBtn').classList.toggle('hidden', !picked);
    });
    $('freeInput').addEventListener('keydown', function(e){
      if(e.key === 'Enter' && picked){ e.preventDefault(); next(); }
    });
  }
  $('restartBtn').addEventListener('click', restart);
  $('thanksRestartBtn').addEventListener('click', restart);
  if($('likeBtn')) $('likeBtn').addEventListener('click', doLike);

  // 结尾黑屏：点击或回车继续（与开场过场一样有 400ms 防误触）
  function storyBlackoutAdvance(){ next(); }
  $('storyBlackout').addEventListener('click', storyBlackoutAdvance);
  $('storyBlackout').addEventListener('keydown', function(e){
    if(e.key==='Enter'||e.key===' '){ e.preventDefault(); storyBlackoutAdvance(); }
  });

  // 语言切换：选项序号跨语言通用（存档按序号存），只重绘文案，进度/答案不动
  function setLang(v){
    if(v !== 'zh' && !(window.I18N && window.I18N[v])) v = 'zh';
    lang = v;
    try{ localStorage.setItem(LANG_KEY, v); }catch(e){}
    renderStatic();
    // 按当前所在视图重绘对应文案
    if(!$('quiz').classList.contains('hidden')) renderQuestion();
    else if(!$('result').classList.contains('hidden')) renderResult();
  }
  if($('langSel')) $('langSel').addEventListener('change', function(e){ setLang(e.target.value); });

  // 启动时读取上次选择的语言
  try{
    var savedLang = localStorage.getItem(LANG_KEY);
    if(savedLang === 'zh' || (window.I18N && window.I18N[savedLang])) lang = savedLang;
  }catch(e){}
  renderStatic();
  show('intro');
})();
