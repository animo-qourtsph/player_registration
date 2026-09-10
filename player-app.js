(() => {
  "use strict";
  const config = window.TOURNAMENT_CONFIG;
  const STORAGE_KEY = `animo-registration-draft-${config.tournamentId}-v12`;
  const RECORDS_KEY = `animo-registration-records-${config.tournamentId}`;
  const ADMIN_CONFIG_KEY = `animo-admin-config-${config.tournamentId}-v12`;
  let adminDraft = null;
  let adminTab = "details";
  let heroIndex = 0;
  let heroTimer = null;
  let heroPaused = false;
  let heroTouchStartX = null;
  const stepDefs = [
    ["entry","Entry"],["player","Player 1"],["partner","Partner"],["division","Division"],["payment","Payment"],["consent","Consent"],["review","Review"]
  ];
  const state = {
    step: 0,
    registrationType: "",
    divisions: [],
    player1: {},
    player2: {},
    partnerReference: "",
    additional: {},
    verification1: {},
    verification2: {},
    payment: { method:"", reference:"", amountPaid:"", paymentDate:"", senderName:"", fileName:"", fileType:"" },
    consents: { rules:false, risk:false, privacy:false, accuracy:false, media:false },
    submitted: false,
    reference: "",
    status: "Draft"
  };

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
  const esc = (v="") => String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const placeholder = v => /^\[.+\]$/.test(String(v||"").trim());
  const money = value => value == null || Number.isNaN(Number(value)) ? "[REGISTRATION_FEE]" : new Intl.NumberFormat("en-PH",{style:"currency",currency:config.currency,maximumFractionDigits:0}).format(value);
  const normalizeMobile = value => String(value||"").replace(/\D/g,"").replace(/^63(?=9\d{9}$)/,"0");
  const formatMobile = value => {
    const d = normalizeMobile(value).slice(0,11);
    if (d.length <= 4) return d;
    if (d.length <= 7) return `${d.slice(0,4)} ${d.slice(4)}`;
    return `${d.slice(0,4)} ${d.slice(4,7)} ${d.slice(7)}`;
  };
  const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||"").trim());
  const validMobile = value => /^09\d{9}$/.test(normalizeMobile(value));
  const validClubPageUrl = value => {
    try{
      const url=new URL(String(value||"").trim());
      if(!["http:","https:"].includes(url.protocol))return false;
      const host=url.hostname.toLowerCase().replace(/^www\./,"");
      const allowed=["facebook.com","fb.com","fb.me","mydupr.com","dupr.com"];
      return allowed.some(domain=>host===domain||host.endsWith(`.${domain}`));
    }catch{return false}
  };
  const enabledDivisions = () => config.divisions.filter(d=>d.enabled);
  const getDivision = id => config.divisions.find(d=>d.id===id);
  const adminDisplayValue = value => placeholder(value) ? "" : (value ?? "");
  const nl2br = value => esc(value).replace(/\n/g,"<br>");

  function loadAdminConfig(){
    try{
      const raw=localStorage.getItem(ADMIN_CONFIG_KEY);
      if(!raw)return;
      const packagedFaq=structuredClone(config.faq||[]);
      const saved=JSON.parse(raw);
      Object.assign(config,saved);
      // Preserve prior admin edits, but replace old packaged FAQ placeholders with the new realistic defaults.
      if(!Array.isArray(config.faq)||!config.faq.length){
        config.faq=packagedFaq;
      }else{
        config.faq=config.faq.map((item,i)=>{
          const fallback=packagedFaq.find(f=>f.q===item.q)||packagedFaq[i];
          return fallback&&placeholder(item.a)?{...item,a:fallback.a}:item;
        });
      }
    }catch(e){console.warn("Admin configuration could not be restored",e)}
  }
  function persistAdminConfig(){
    try{localStorage.setItem(ADMIN_CONFIG_KEY,JSON.stringify(config));return true}
    catch(e){console.warn("Admin configuration could not be persisted",e);return false}
  }

  function showToast(message){const t=$("#toast");t.textContent=message;t.classList.add("show");clearTimeout(showToast.t);showToast.t=setTimeout(()=>t.classList.remove("show"),2200)}
  function showView(name){
    $$(".view").forEach(v=>v.classList.remove("is-active"));
    $("#"+name+"View").classList.add("is-active");
    $("#mobileSticky").style.display = name==="landing" ? "" : "none";
    if(name==="landing")restartHeroTimer();else clearInterval(heroTimer);
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function saveDraft(){
    if(state.submitted) return;
    const safe = structuredClone(state);
    // Never persist image/file contents in autosaved drafts. Keep only metadata.
    safe.payment.fileName = state.payment.fileName || "";
    if(safe.verification1) safe.verification1.duprProofDataUrl = "";
    if(safe.verification2) safe.verification2.duprProofDataUrl = "";
    try{localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));}
    catch(e){console.warn("Draft progress could not be persisted",e)}
    const el=$("#saveState"); if(el){el.textContent="Saved progress";}
  }
  function loadDraft(){
    try{const raw=localStorage.getItem(STORAGE_KEY); if(!raw)return; Object.assign(state,JSON.parse(raw));state.additional={};state.verification1||={};state.verification2||={};}
    catch(e){console.warn("Draft could not be restored",e)}
  }
  function getRecords(){try{return JSON.parse(localStorage.getItem(RECORDS_KEY)||"[]")}catch{return []}}
  function saveRecord(record){const records=getRecords();records.push(record);localStorage.setItem(RECORDS_KEY,JSON.stringify(records))}
  function participantKey(player){
    if(!player)return "";
    const email=String(player.email||"").trim().toLowerCase();
    const mobile=normalizeMobile(player.mobile||"");
    if(email)return `email:${email}`;
    if(mobile)return `mobile:${mobile}`;
    const name=[player.firstName,player.lastName].filter(Boolean).join(" ").trim().toLowerCase();
    const birth=String(player.birthDate||"").trim();
    return name?`name:${name}|${birth}`:"";
  }
  function recordParticipantSlots(record){
    if(record?.registrationType==="individual")return 1;
    if(["pair","invite","existing"].includes(record?.registrationType))return 2;
    return record?.player2?.firstName||record?.player2?.email||record?.player2?.mobile?2:1;
  }
  function confirmedParticipantsFromRecords(){
    const unique=new Set();
    getRecords().filter(r=>r.status==="Confirmed").forEach(r=>{
      [r.player1,r.player2].forEach(player=>{const key=participantKey(player);if(key)unique.add(key)});
      // Existing-partner entries may only contain Player 1 locally; the linked partner is expected to exist as a separate confirmed record.
    });
    return unique.size;
  }
  function getConfirmedParticipantCount(){
    const override=config.publicStats?.confirmedParticipantsOverride;
    if(override!==null&&override!==""&&Number.isFinite(Number(override)))return Math.max(0,Math.floor(Number(override)));
    return confirmedParticipantsFromRecords();
  }
  function reservedParticipantsForDivision(divisionId){
    return getRecords().filter(r=>Array.isArray(r.divisions)&&r.divisions.includes(divisionId)&&!["Cancelled","Waitlisted"].includes(r.status)).reduce((sum,r)=>sum+recordParticipantSlots(r),0);
  }
  function divisionCapacityState(d){
    const max=d.maxParticipants==null||d.maxParticipants===""?null:Math.max(0,Number(d.maxParticipants));
    const locallyRemaining=max==null?null:Math.max(0,max-reservedParticipantsForDivision(d.id));
    const manualSlots=d.slotsRemaining==null||d.slotsRemaining===""?null:Number(d.slotsRemaining);
    const full=(manualSlots!=null&&manualSlots<=0)||(locallyRemaining!=null&&locallyRemaining<=0);
    return {max,locallyRemaining,manualSlots,full};
  }

  function duprThresholds(){
    const t=config.duprEligibility?.thresholds||{};
    return {
      lowIntermediateMin:Number(t.lowIntermediateMin??3),
      highIntermediateMin:Number(t.highIntermediateMin??3.5),
      advancedMin:Number(t.advancedMin??4)
    };
  }
  function duprLevelLabel(levelKey){
    const labels=config.duprEligibility?.labels||{};
    return labels[levelKey]||({beginner:"Beginner",lowIntermediate:"Low Intermediate",highIntermediate:"High Intermediate",advanced:"Advanced"}[levelKey])||"Manual Verification";
  }
  function classifyDuprRating(value){
    if(value==null||value===""||!Number.isFinite(Number(value)))return null;
    const rating=Number(value);if(rating<=0)return null;
    const t=duprThresholds();
    const levelKey=rating>=t.advancedMin?"advanced":rating>=t.highIntermediateMin?"highIntermediate":rating>=t.lowIntermediateMin?"lowIntermediate":"beginner";
    return {rating,levelKey,label:duprLevelLabel(levelKey)};
  }
  function divisionLevelKey(d){
    if(d?.levelKey)return d.levelKey;
    const text=`${d?.id||""} ${d?.classification||""}`.toLowerCase();
    if(text.includes("advanced"))return "advanced";
    if(text.includes("high"))return "highIntermediate";
    if(text.includes("low"))return "lowIntermediate";
    if(text.includes("beginner"))return "beginner";
    return "";
  }
  function levelRank(levelKey){
    return ({beginner:1,lowIntermediate:2,highIntermediate:3,advanced:4})[levelKey]||0;
  }
  function verificationEligibility(data){
    if(data?.hasDupr==="No"){
      const validated=String(data?.organizerAssignedLevel||"").trim();
      if(validated&&data?.manualLevelApproved){
        return {manual:false,pending:false,classificationPending:false,levelKey:validated,label:duprLevelLabel(validated),rating:null,source:"organizer-validated",reason:"Organizer-validated level"};
      }
      const requested=String(data?.requestedLevel||"").trim();
      if(!requested){
        return {manual:true,pending:true,classificationPending:true,levelKey:null,label:"Requested level required",rating:null,source:"player-declared",reason:"Select the playing level you are requesting so the organizer can validate it."};
      }
      return {manual:true,pending:false,classificationPending:false,levelKey:requested,label:duprLevelLabel(requested),rating:null,source:"player-declared",reason:"Requested level is subject to organizer validation"};
    }
    if(data?.hasDupr!=="Yes")return {manual:false,pending:true,classificationPending:true,levelKey:null,label:"DUPR status required",rating:null,source:"",reason:"DUPR selection required"};
    const level=classifyDuprRating(data?.duprRating);
    if(!level)return {manual:false,pending:true,classificationPending:true,levelKey:null,label:"Enter a valid DUPR rating",rating:null,source:"DUPR",reason:"Enter a valid DUPR rating"};
    const proofReady=!!(data?.duprProofName&&data?.duprProofDataUrl);
    const verified=data?.duprProofStatus==="Verified";
    return {...level,manual:!verified,pending:!proofReady&&!verified,classificationPending:false,source:"DUPR",proofReady,verified,reason:verified?"DUPR proof verified":proofReady?"DUPR screenshot pending organizer verification":"DUPR screenshot required"};
  }
  function teamCategoryDecision(){
    if(state.registrationType!=="pair")return {categoryKey:null,label:"Category pending",pending:true,reason:"Partner information must be completed before category can be determined."};
    const g1=state.player1?.gender,g2=state.player2?.gender;
    if(g1==="Male"&&g2==="Male")return {categoryKey:"men",label:"Men's Doubles",pending:false};
    if(g1==="Female"&&g2==="Female")return {categoryKey:"women",label:"Women's Doubles",pending:false};
    if((g1==="Male"&&g2==="Female")||(g1==="Female"&&g2==="Male"))return {categoryKey:"mixed",label:"Mixed Doubles",pending:false};
    return {categoryKey:null,label:"Category verification required",pending:true,reason:"Gender must be Male or Female before the doubles category can be determined automatically."};
  }
  function divisionCategoryKey(d){
    const id=String(d?.id||"").toLowerCase();
    const text=`${d?.classification||""} ${d?.name||""}`.toLowerCase();
    if(id.endsWith("-mixed")||text.includes("mixed"))return "mixed";
    if(id.endsWith("-women")||text.includes("women"))return "women";
    if(id.endsWith("-men")||text.includes("men's")||text.includes(" men"))return "men";
    return "";
  }
  function teamEligibilityDecision(){
    const partnerPending=["invite","existing"].includes(state.registrationType);
    if(partnerPending){
      const p1=verificationEligibility(state.verification1);
      return {levelKey:p1.levelKey||null,label:p1.levelKey?p1.label:"Division pending",rating:p1.rating??null,controller:"Player 1",manualReview:true,partnerPending:true,classificationPending:true,levelMismatch:false,categoryPending:true,categoryKey:null,categoryLabel:"Pending partner",source:p1.source||"",reason:"Final level and category will be determined after the partner completes or links their verified profile."};
    }
    if(state.registrationType==="individual"){
      const p1=verificationEligibility(state.verification1);
      return {levelKey:p1.levelKey||null,label:p1.levelKey?p1.label:"Level information required",rating:p1.rating??null,controller:"Player 1",manualReview:true,partnerPending:false,classificationPending:!p1.levelKey,levelMismatch:false,categoryPending:true,categoryKey:null,categoryLabel:"Partner pending",source:p1.source||"",reason:"A doubles category cannot be assigned until a partner is available."};
    }
    const assessed=[
      {playerLabel:"Player 1",...verificationEligibility(state.verification1)},
      {playerLabel:"Player 2",...verificationEligibility(state.verification2)}
    ];
    if(assessed.some(x=>!x.levelKey)){
      return {levelKey:null,label:"Level information required",rating:null,controller:"",manualReview:true,partnerPending:false,classificationPending:true,levelMismatch:false,categoryPending:false,categoryKey:null,categoryLabel:"",source:"",reason:"At least one player is missing the level information required to determine the team division."};
    }
    if(assessed[0].levelKey!==assessed[1].levelKey){
      return {levelKey:null,label:"Partner level mismatch",rating:null,controller:"",manualReview:true,partnerPending:false,classificationPending:false,levelMismatch:true,categoryPending:false,categoryKey:null,categoryLabel:"",source:"",player1Level:assessed[0].levelKey,player2Level:assessed[1].levelKey,reason:`Player 1 is ${assessed[0].label} while Player 2 is ${assessed[1].label}. Both partners must be in the same tournament level.`};
    }
    const category=teamCategoryDecision();
    const levelKey=assessed[0].levelKey;
    const ratings=assessed.map(x=>x.rating).filter(v=>v!=null).map(Number);
    return {
      levelKey,
      label:duprLevelLabel(levelKey),
      rating:ratings.length?Math.max(...ratings):null,
      controller:"",
      manualReview:assessed.some(x=>x.manual)||category.pending,
      partnerPending:false,
      classificationPending:false,
      levelMismatch:false,
      categoryPending:category.pending,
      categoryKey:category.categoryKey,
      categoryLabel:category.label,
      source:assessed.some(x=>x.source==="organizer-validated")?"organizer-validated":assessed.some(x=>x.source==="player-declared")?"player-declared":"DUPR",
      reason:category.pending?(category.reason||"Category verification required"):(assessed.some(x=>x.manual)?"Same-level pair · organizer validation still required":"Same-level pair verified")
    };
  }
  function eligibleDivisions(){
    const decision=teamEligibilityDecision();
    if(!decision.levelKey||decision.levelMismatch||decision.classificationPending||decision.categoryPending||!decision.categoryKey)return [];
    return enabledDivisions().filter(d=>divisionLevelKey(d)===decision.levelKey&&divisionCategoryKey(d)===decision.categoryKey);
  }
  function sanitizeDivisionSelection(){
    const decision=teamEligibilityDecision();
    const exact=eligibleDivisions();
    if(decision.levelMismatch||decision.classificationPending||decision.categoryPending||exact.length!==1){
      state.divisions=[];
      return;
    }
    const cap=divisionCapacityState(exact[0]);
    state.divisions=cap.full?[]:[exact[0].id];
  }
  function duprRangeText(levelKey){
    const t=duprThresholds();
    if(levelKey==="beginner")return `Below ${t.lowIntermediateMin.toFixed(2)}`;
    if(levelKey==="lowIntermediate")return `${t.lowIntermediateMin.toFixed(2)} – ${(t.highIntermediateMin-0.01).toFixed(2)}`;
    if(levelKey==="highIntermediate")return `${t.highIntermediateMin.toFixed(2)} – ${(t.advancedMin-0.01).toFixed(2)}`;
    if(levelKey==="advanced")return `${t.advancedMin.toFixed(2)}+`;
    return "";
  }
  function buildEligibilitySnapshot(){
    const d=teamEligibilityDecision();
    return {
      levelKey:d.levelKey||null,
      levelLabel:d.levelKey?duprLevelLabel(d.levelKey):d.label,
      controllingRating:d.rating??null,
      controller:d.controller||null,
      source:d.source||null,
      manualReview:!!d.manualReview,
      partnerPending:!!d.partnerPending,
      classificationPending:!!d.classificationPending,
      levelMismatch:!!d.levelMismatch,
      categoryPending:!!d.categoryPending,
      categoryKey:d.categoryKey||null,
      categoryLabel:d.categoryLabel||null,
      rule:"both partners must be in the same level; gender is Male/Female only and determines the doubles category automatically; no-DUPR players may request a level subject to organizer validation using a club DUPR/Facebook page link"
    };
  }
  function renderLanding(){
    renderHeroCarousel();
    const snapshot = [
      ["Confirmed participants",getConfirmedParticipantCount().toLocaleString("en-PH"),"fomo"],
      ["Event date",config.eventDate],["Venue",config.venue],["Registration deadline",config.registrationDeadline],["Eligibility",config.eligibilitySummary]
    ];
    $("#snapshotGrid").innerHTML=snapshot.map(([k,v,kind])=>`<div class="snapshot-item ${kind==="fomo"?"snapshot-fomo":""}"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("");
    const details=[
      ["Organizer",config.organizer,"Official tournament organizer"],["Event date",config.eventDate,"Configured tournament date"],["Venue",config.venue,"Tournament location"],["Registration deadline",config.registrationDeadline,"Last date to submit"],
      ["Divisions",enabledDivisions().length?`${enabledDivisions().length} configured`:"[DIVISION_LIST]","Organizer-approved categories only"],["Registration fee",feeLabel(),"Per player; doubles pair total is calculated automatically"],["Eligibility",config.eligibilitySummary,"Participant requirements"],["Tournament format",config.formatSummary,"Organizer-approved competition format"]
    ];
    $("#detailGrid").innerHTML=details.map(([k,v,p])=>`<article class="detail-card"><span>${esc(k)}</span><strong>${esc(v)}</strong><p>${esc(p)}</p></article>`).join("");
    const timeline=[["Registration opens",config.registrationOpening],["Registration deadline",config.registrationDeadline],["Final player confirmation",config.finalPlayerConfirmation||"[FINAL_PLAYER_CONFIRMATION]"],["Schedule release",config.scheduleRelease],["Tournament day",config.eventDate]];
    $("#timeline").innerHTML=timeline.map(([a,b])=>`<li><strong>${esc(a)}</strong><span>${esc(b)}</span></li>`).join("");
    $("#faqList").innerHTML=config.faq.map((item,i)=>`<div class="faq-item"><button class="faq-button" type="button" aria-expanded="false"><span>${esc(item.q)}</span><span>+</span></button><div class="faq-answer">${esc(item.a)}</div></div>`).join("");
    $$(".faq-button").forEach(btn=>btn.addEventListener("click",()=>{const item=btn.parentElement;item.classList.toggle("open");btn.setAttribute("aria-expanded",item.classList.contains("open"));btn.lastElementChild.textContent=item.classList.contains("open")?"−":"+"}));
    $("#footerContact").textContent=[config.contact.email,config.contact.mobile].filter(v=>v&&!placeholder(v)).join(" · ") || "[ORGANIZER_CONTACT]";
    const brandStrong=$(".brand-copy strong"),brandSmall=$(".brand-copy small"),footerTitle=$(".footer-shell strong"),footerOrganizer=$(".footer-shell>div:first-child p"),confirmationLead=$(".confirmation-lead");
    if(brandStrong)brandStrong.textContent=config.name.replace(/Pickleball Cup 2026/i,"").trim()||"Animo";
    if(brandSmall)brandSmall.textContent=config.name.match(/Pickleball Cup 2026/i)?.[0]||"Pickleball Cup 2026";
    if(footerTitle)footerTitle.textContent=config.name;if(footerOrganizer)footerOrganizer.textContent=`Organized by ${config.organizer}`;if(confirmationLead)confirmationLead.textContent=`Welcome to ${config.name}.`;
  }
  function renderHeroCarousel(){
    const slides=config.heroCarousel?.slides?.length?config.heroCarousel.slides:[{eyebrow:config.organizer,headline:config.name,body:"One community. One court. One Animo.",image:"",imageAlt:"",imagePosition:"center",contentPosition:"center",primaryCtaLabel:"Register Now",secondaryCtaLabel:"Tournament Details",showSecondaryCta:false}];
    if(heroIndex>=slides.length)heroIndex=0;
    const host=$("#heroSlides");
    host.innerHTML=slides.map((slide,i)=>{
      const image=String(slide.image||"").trim();
      const imagePosition=["center","top","bottom","left","right"].includes(slide.imagePosition)?slide.imagePosition:"center";
      const contentPosition=slide.contentPosition==="left"?"left":"center";
      const imageStyle=image?`style="background-image:linear-gradient(180deg,rgba(0,0,0,.04) 0%,rgba(0,0,0,.04) 48%,rgba(0,0,0,.56) 100%),url('${esc(image)}');background-position:${esc(imagePosition)}"`:"";
      const secondary=slide.showSecondaryCta?`<button class="hero-pill hero-pill-secondary" data-action="details">${esc(slide.secondaryCtaLabel||"Tournament Details")}</button>`:"";
      return `<article class="hero-slide ${i===heroIndex?"active":""} hero-content-${contentPosition} ${image?"has-image":"no-image"}" ${imageStyle} role="group" aria-roledescription="slide" aria-label="${i+1} of ${slides.length}" aria-hidden="${i===heroIndex?"false":"true"}"><div class="hero-slide-inner"><div class="hero-slide-copy">${slide.eyebrow?`<p class="hero-campaign-kicker">${esc(slide.eyebrow)}</p>`:""}<h1 ${i===0?'id="heroTitle"':''}>${nl2br(slide.headline||config.name)}</h1>${slide.body?`<p class="hero-line">${esc(slide.body)}</p>`:""}<div class="hero-cta-row"><button class="hero-pill" data-action="register">${esc(slide.primaryCtaLabel||"Register Now")}</button>${secondary}</div></div>${image?"":`<div class="hero-fallback-art" aria-hidden="true"><span>ANIMO</span><strong>2026</strong></div>`}</div></article>`;
    }).join("");
    $("#heroDots").innerHTML=slides.map((_,i)=>`<button type="button" class="hero-dot ${i===heroIndex?"active":""}" data-hero-index="${i}" aria-label="Show slide ${i+1}" aria-current="${i===heroIndex?"true":"false"}"></button>`).join("");
    $("#heroCount").textContent=`${String(heroIndex+1).padStart(2,"0")} / ${String(slides.length).padStart(2,"0")}`;
    $("#heroPrev").hidden=slides.length<2;$("#heroNext").hidden=slides.length<2;$("#heroPause").hidden=slides.length<2;
    updateHeroPauseButton();
    $$('[data-action]',host).forEach(btn=>btn.onclick=()=>handleAction(btn.dataset.action));
    $$("[data-hero-index]",$("#heroCarousel")).forEach(btn=>btn.onclick=()=>setHeroSlide(Number(btn.dataset.heroIndex),true));
    restartHeroTimer();
  }
  function setHeroSlide(index,userInitiated=false){
    const slides=config.heroCarousel?.slides||[];if(!slides.length)return;
    heroIndex=(index+slides.length)%slides.length;
    renderHeroCarousel();
    if(userInitiated)restartHeroTimer();
  }
  function updateHeroPauseButton(){
    const btn=$("#heroPause");if(!btn)return;
    btn.textContent=heroPaused?"▶":"Ⅱ";
    btn.setAttribute("aria-label",heroPaused?"Play hero carousel":"Pause hero carousel");
    btn.setAttribute("aria-pressed",heroPaused?"true":"false");
  }
  function toggleHeroPause(){
    heroPaused=!heroPaused;updateHeroPauseButton();restartHeroTimer();
  }
  function restartHeroTimer(){
    clearInterval(heroTimer);
    const slides=config.heroCarousel?.slides||[];
    if(heroPaused||slides.length<2||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    heroTimer=setInterval(()=>setHeroSlide(heroIndex+1),Number(config.heroCarousel.autoplayMs)||6500);
  }
  function feeLabel(){const vals=enabledDivisions().map(d=>d.fee).filter(v=>v!=null);if(!vals.length)return "[REGISTRATION_FEE]";return vals.every(v=>v===vals[0])?money(vals[0]):"Varies by division"}

  function renderProgress(){
    $("#progressList").innerHTML=stepDefs.map(([,label],i)=>`<li class="${i===state.step?"active":i<state.step?"done":""}" ${i===state.step?'aria-current="step"':''}>${String(i+1).padStart(2,"0")} ${label}</li>`).join("");
  }
  function renderStep(){
    renderProgress();
    const container=$("#stepContainer");
    const renderers=[renderEntry,renderPlayer,renderPartner,renderDivision,renderPayment,renderConsent,renderReview];
    container.innerHTML=`<div class="step-content">${renderers[state.step]()}</div>`;
    $("#backButton").style.visibility=state.step===0?"hidden":"visible";
    if(state.step===stepDefs.length-1){
      const finalDecision=teamEligibilityDecision();
      $("#nextButton").textContent=finalDecision.manualReview?"Submit for Review":"Submit Registration";
    }else{
      $("#nextButton").textContent="Continue";
    }
    bindStepEvents();
    saveDraft();
  }

  function stepHeading(kicker,title,copy){return `<div class="step-heading"><span class="step-kicker">${esc(kicker)}</span><h2>${esc(title)}</h2><p>${esc(copy)}</p></div>`}
  function renderEntry(){
    const types=config.registrationTypes.filter(t=>t.enabled);
    return `${stepHeading("01 · Registration setup","How are you registering?","Choose one option below, then continue. We’ll collect player details and level information next.")}
      <div class="subsection"><div class="subsection-heading"><div><h3>Registration type</h3><p>One division per player. Double entry is not allowed.</p></div></div><div class="choice-grid">${types.map(t=>`<button type="button" class="choice-card ${state.registrationType===t.id?"selected":""}" data-type="${esc(t.id)}"><strong>${esc(t.label)}</strong><p>${esc(t.description)}</p></button>`).join("")}</div></div>`;
  }
  function divisionCard(d){
    const cap=divisionCapacityState(d);
    const remainingLabel=cap.manualSlots!=null?(cap.full?"Registration full":`${cap.manualSlots} team slots remaining`):(cap.full?"Registration full":"");
    return `<button type="button" class="division-card ${state.divisions.includes(d.id)?"selected":""} ${cap.full?"disabled":""}" data-division="${esc(d.id)}" ${cap.full?"disabled":""}><strong>${esc(d.name)}</strong><p>${esc(d.description||d.classification||"")}</p><div class="card-meta"><span class="meta-chip">${esc(d.classification||"Division")}</span><span class="meta-chip">${money(d.fee)} / player</span>${cap.max!=null?`<span class="meta-chip">Max ${esc(Math.floor(cap.max))} participants</span>`:""}${remainingLabel?`<span class="meta-chip">${esc(remainingLabel)}</span>`:""}</div></button>`
  }
  function playerFields(prefix,data,label){
    return `<div class="player-banner"><strong>${esc(label)}</strong><span class="status-pill">Tournament profile</span></div><div class="form-grid">
      ${field(prefix,"firstName","First Name",data.firstName,"text","given-name")}${field(prefix,"middleName","Middle Name / Initial",data.middleName,"text","additional-name",false)}${field(prefix,"lastName","Last Name",data.lastName,"text","family-name")}${field(prefix,"displayName","Tournament Display Name",data.displayName,"text","nickname",true,"May appear in schedules, brackets, live results, and Match Control displays.")}
      ${selectField(prefix,"gender","Gender",data.gender,["","Male","Female"])}${field(prefix,"birthDate","Birth Date",data.birthDate,"date","bday")}${field(prefix,"mobile","Mobile Number",formatMobile(data.mobile),"tel","tel",true,"Philippine format: 09XX XXX XXXX")}${field(prefix,"email","Email Address",data.email,"email","email")}
    </div>`;
  }
  function field(prefix,key,label,value,type="text",autocomplete="off",required=true,helper=""){return `<label class="field" data-field="${prefix}.${key}"><span>${esc(label)}${required?" *":""}</span><input name="${prefix}.${key}" type="${type}" value="${esc(value||"")}" autocomplete="${autocomplete}" ${required?"required":""} ${type==="tel"?'inputmode="tel"':type==="number"?'step="any" inputmode="decimal"':''}/>${helper?`<small>${esc(helper)}</small>`:""}<em class="field-error"></em></label>`}
  function selectField(prefix,key,label,value,opts,required=true){return `<label class="field" data-field="${prefix}.${key}"><span>${esc(label)}${required?" *":""}</span><select name="${prefix}.${key}" ${required?"required":""}>${opts.map(o=>`<option value="${esc(o)}" ${o===value?"selected":""}>${esc(o||"Select")}</option>`).join("")}</select><em class="field-error"></em></label>`}
  function requestedLevelField(prefix,data){
    const opts=[["","Select requested level"],["beginner","Beginner"],["lowIntermediate","Low Intermediate"],["highIntermediate","High Intermediate"],["advanced","Advanced"]];
    const value=String(data?.requestedLevel||"");
    const isPlayer2=prefix==="verification2";
    const p1Level=verificationEligibility(state.verification1).levelKey||"";
    const helper=isPlayer2
      ? (p1Level
          ? `Player 1 is currently ${duprLevelLabel(p1Level)}. This level is preselected by default because both partners must register in the same tournament tier.`
          : "Player 1's level must be established first. Both partners must register in the same tournament tier.")
      : "Choose the level you are requesting. The organizer may approve, reclassify, or decline the registration after validation.";
    return `<label class="field" data-field="${prefix}.requestedLevel"><span>Requested Playing Level *</span><select name="${prefix}.requestedLevel" required>${opts.map(([v,l])=>`<option value="${esc(v)}" ${v===value?"selected":""}>${esc(l)}</option>`).join("")}</select><small>${esc(helper)}</small><em class="field-error"></em></label>`;
  }
  function duprRatingField(prefix,data){
    const required=data?.hasDupr==="Yes";
    return `<label class="field" data-field="${prefix}.duprRating"><span>Current DUPR Rating${required?" *":""}</span><input name="${prefix}.duprRating" type="number" value="${esc(data?.duprRating||"")}" inputmode="decimal" step="0.01" min="0.01" max="8" ${required?"required":""}/><small>Enter the numeric rating shown on your DUPR profile, for example 3.45.</small><em class="field-error"></em></label>`;
  }
  
  function textareaField(prefix,key,label,value,required=false,helper=""){
    return `<label class="field full" data-field="${prefix}.${key}"><span>${esc(label)}${required?" *":""}</span><textarea name="${prefix}.${key}" ${required?"required":""}>${esc(value||"")}</textarea>${helper?`<small>${esc(helper)}</small>`:""}<em class="field-error"></em></label>`;
  }
  function duprProofField(prefix,data){
    const fileId=`duprProofFile-${prefix}`;
    return `<div class="field full" data-field="${prefix}.duprProof"><span>DUPR Screenshot Proof *</span><div class="file-drop dupr-proof-drop"><label for="${esc(fileId)}">${data?.duprProofDataUrl?"Replace DUPR Screenshot":"Upload DUPR Screenshot"}</label><p>Upload a clear screenshot showing your name and current DUPR rating. JPG or PNG, up to 8 MB.</p><input id="${esc(fileId)}" data-dupr-proof="${esc(prefix)}" type="file" accept="image/jpeg,image/png"/>${data?.duprProofDataUrl?`<div class="file-confirm">✓ ${esc(data.duprProofName||"DUPR screenshot")}</div>`:data?.duprProofName?`<div class="file-reupload">Screenshot must be re-uploaded after refreshing this preview.</div>`:""}${data?.duprProofDataUrl?`<div class="dupr-proof-preview"><img src="${esc(data.duprProofDataUrl)}" alt="Uploaded DUPR screenshot preview"/><span>Preview ready for organizer verification</span></div>`:""}</div><em class="field-error"></em></div>`;
  }
  function verificationFields(prefix,data,label){
    const hasDupr=data.hasDupr||"";
    return `<div class="verification-block"><div class="subsection-heading"><div><h3>Level verification</h3><p>Tell us whether you have a DUPR rating. If you do not, you may request a playing level and the organizer will validate it using the information you provide.</p></div><span class="status-pill">${esc(label)}</span></div><div class="form-grid">
      ${field(prefix,"clubAffiliation","Club Affiliation",data.clubAffiliation,"text","organization",true,'Enter your current pickleball club. If you are not affiliated with a club, enter "No Club".')}
      ${field(prefix,"jerseyName","Name to Print on Back of Jersey",data.jerseyName,"text","off",true,"Enter the exact spelling and capitalization you want printed on your jersey.")}
      ${selectField(prefix,"hasDupr","Do you currently have a DUPR rating?",hasDupr,["","Yes","No"])}
      ${hasDupr==="Yes"?field(prefix,"duprId","DUPR ID / Profile URL",data.duprId,"text","off",false,"Optional for now. Enter your DUPR ID or profile URL if available."):""}
      ${hasDupr==="Yes"?duprRatingField(prefix,data):""}
      ${hasDupr==="Yes"?duprProofField(prefix,data):""}
      ${hasDupr==="No"?requestedLevelField(prefix,data):""}
      ${hasDupr==="No"?field(prefix,"verificationReference","Club DUPR / Facebook Page Link",data.verificationReference,"url","url",true,"Paste your club's DUPR page link or official Facebook page link. This gives the organizer a quick reference for level validation."):""}
      ${hasDupr==="No"?textareaField(prefix,"playingBackground","Playing Background & Recent Tournament History",data.playingBackground,true,"Include years playing, recent tournaments, placements, club-assigned level, leagues, or other information the organizer can use to validate your requested level."):""}
    </div><div class="eligibility-live" data-eligibility-output="${esc(prefix)}">${eligibilityOutputMarkup(data,label)}</div></div>`;
  }
  function renderPlayer(){
    return `${stepHeading("02 · Player 1 information","Tell us about Player 1.","Complete your tournament profile and level-verification details in one step.")}
      ${playerFields("player1",state.player1,"PLAYER 1")}
      <div class="subsection">${verificationFields("verification1",state.verification1,"PLAYER 1")}</div>`;
  }

  function renderPartner(){
    if(state.registrationType==="invite") return `${stepHeading("03 · Partner information","Invite your partner.","Provide enough information to identify your partner. Their full profile and level verification will be completed later.")}<div class="form-grid">${field("player2","firstName","Partner First Name",state.player2.firstName)}${field("player2","lastName","Partner Last Name",state.player2.lastName)}${field("player2","email","Partner Email",state.player2.email,"email","email")}${field("player2","mobile","Partner Mobile",formatMobile(state.player2.mobile),"tel","tel")}</div><div class="config-alert" style="margin-top:18px"><strong>Partner verification will still be required.</strong><br>Your provisional team level is based on Player 1 until your invited partner completes their DUPR or manual level verification.</div>`;
    if(state.registrationType==="existing") return `${stepHeading("03 · Partner information","Link an existing partner.","Use an approved registration reference. The linked player's existing level-verification record will be checked before final approval.")}<div class="form-grid">${field("partner","reference","Partner Registration Reference",state.partnerReference,"text","off")}</div>`;
    if(state.registrationType==="individual") return `${stepHeading("03 · Partner information","Partner details are not required yet.","The organizer has enabled individual registration. Partner assignment or matching must follow organizer-approved rules.")}<div class="empty-state"><strong>Individual entry selected</strong>Partner details can be completed later if the tournament configuration allows it.</div>`;
    return `${stepHeading("03 · Partner information","Add Player 2.","Complete Player 2's tournament profile and level-verification details.")}
      ${playerFields("player2",state.player2,"PLAYER 2")}
      <div class="subsection">${verificationFields("verification2",state.verification2,"PLAYER 2")}</div>`;
  }

  function eligibilityOutputMarkup(data,label){
    const result=verificationEligibility(data);
    if(data?.hasDupr==="No"){
      if(data?.manualLevelApproved&&result.levelKey)return `<div class="eligibility-result success"><span>Organizer-validated level</span><strong>${esc(result.label)}</strong><p>${esc(label)}'s playing level has been validated by the tournament organizer.</p></div>`;
      if(result.levelKey)return `<div class="eligibility-result manual"><span>Requested level</span><strong>${esc(result.label)}</strong><p>Subject to organizer validation using the club page link and playing background provided.</p></div>`;
      return `<div class="eligibility-result neutral"><span>Requested level required</span><strong>Select the level you are requesting</strong><p>The organizer will validate the request before final approval.</p></div>`;
    }
    if(data?.hasDupr!=="Yes")return `<div class="eligibility-result neutral"><span>Level not calculated yet</span><strong>Select your DUPR status</strong><p>Choose Yes or No so the correct verification path can appear.</p></div>`;
    if(!result.levelKey)return `<div class="eligibility-result neutral"><span>DUPR rating required</span><strong>Enter your current rating</strong><p>The system will calculate a provisional level once a valid rating is entered.</p></div>`;
    return `<div class="eligibility-result ${result.verified?"success":"manual"}"><span>${result.verified?"Verified level":"Provisional level"}</span><strong>${esc(result.label)} · DUPR ${Number(result.rating).toFixed(2)}</strong><p>${esc(result.reason)}.</p></div>`;
  }
  function updateEligibilityOutputs(){
    $$('[data-eligibility-output]').forEach(el=>{
      const prefix=el.dataset.eligibilityOutput;
      const label=prefix==="verification2"?"Player 2":"Player 1";
      el.innerHTML=eligibilityOutputMarkup(state[prefix]||{},label);
    });
  }

  function placementPlayerSummaryMarkup(player,verification,label){
    const eligibility=verificationEligibility(verification||{});
    const name=[player?.firstName,player?.middleName,player?.lastName].filter(Boolean).join(" ").trim()||label;
    const gender=player?.gender||"Pending";
    const club=verification?.clubAffiliation||"—";
    let ratingLine="DUPR status pending";
    let verificationLine="Level information incomplete";
    if(verification?.hasDupr==="Yes"){
      ratingLine=eligibility.rating!=null?`DUPR ${Number(eligibility.rating).toFixed(2)}`:"DUPR rating pending";
      verificationLine=eligibility.verified?"Screenshot verified":"Screenshot pending organizer verification";
    }else if(verification?.hasDupr==="No"){
      ratingLine="No DUPR rating";
      verificationLine=eligibility.levelKey
        ? `${duprLevelLabel(eligibility.levelKey)} requested · subject to organizer validation`
        : "Requested level pending";
    }
    const levelLabel=eligibility.levelKey?duprLevelLabel(eligibility.levelKey):"Pending";
    return `<article class="placement-player-card">
      <header><span class="placement-player-label">${esc(label)}</span><span class="status-pill ${eligibility.manual&&!eligibility.verified?"warning-pill":""}">${esc(levelLabel)}</span></header>
      <h4>${esc(name)}</h4>
      <dl class="placement-detail-list">
        <div><dt>Gender</dt><dd>${esc(gender)}</dd></div>
        <div><dt>Club</dt><dd>${esc(club)}</dd></div>
        <div><dt>Rating basis</dt><dd>${esc(ratingLine)}</dd></div>
        <div><dt>Validation</dt><dd>${esc(verificationLine)}</dd></div>
      </dl>
    </article>`;
  }
  function placementSummaryMarkup(decision){
    const p1=verificationEligibility(state.verification1||{});
    const p2=verificationEligibility(state.verification2||{});
    const p1Level=p1.levelKey?duprLevelLabel(p1.levelKey):"Pending";
    const p2Level=p2.levelKey?duprLevelLabel(p2.levelKey):"Pending";
    const gender1=state.player1?.gender||"Pending";
    const gender2=state.player2?.gender||"Pending";
    const category=decision?.categoryLabel||teamCategoryDecision().label||"Pending";
    const levelOutcome=decision?.levelMismatch
      ? `${p1Level} + ${p2Level} → Mismatch`
      : (decision?.levelKey?`${p1Level} + ${p2Level} → ${duprLevelLabel(decision.levelKey)}`:`${p1Level} + ${p2Level}`);
    const categoryOutcome=decision?.categoryPending
      ? `${gender1} + ${gender2} → Pending`
      : `${gender1} + ${gender2} → ${category}`;
    return `<div class="placement-summary">
      <div class="subsection-heading placement-summary-heading">
        <div><h3>Player details used for placement</h3><p>The system uses each player's level and the gender combination below to determine the division automatically.</p></div>
      </div>
      <div class="placement-player-grid">
        ${placementPlayerSummaryMarkup(state.player1,state.verification1,"PLAYER 1")}
        ${placementPlayerSummaryMarkup(state.player2,state.verification2,"PLAYER 2")}
      </div>
      <div class="placement-logic-grid">
        <div class="placement-logic-item">
          <span>Level check</span>
          <strong>${esc(levelOutcome)}</strong>
          <small>Both partners must be in the same tournament tier.</small>
        </div>
        <div class="placement-logic-item">
          <span>Category check</span>
          <strong>${esc(categoryOutcome)}</strong>
          <small>Male + Male = Men's · Female + Female = Women's · Male + Female = Mixed.</small>
        </div>
      </div>
    </div>`;
  }

  function renderDivision(){
    sanitizeDivisionSelection();
    const decision=teamEligibilityDecision();
    const divs=eligibleDivisions();
    if(decision.levelMismatch){
      return `${stepHeading("04 · Division","Partner levels do not match.","Both players must be classified in the same tournament level before registration can continue.")}
        <div class="team-eligibility-card manual"><span>Registration blocked</span><strong>Partner Level Mismatch</strong><p>${esc(decision.reason)}</p></div>
        ${placementSummaryMarkup(decision)}
        <div class="config-alert"><strong>What to do:</strong><br>Return to the Player or Partner step and correct the DUPR information if it was entered incorrectly. The system will not automatically move a mismatched pair into the higher division.</div>`;
    }
    if(decision.classificationPending||decision.partnerPending){
      return `${stepHeading("04 · Division","Division pending organizer review.","Your final tournament level must be resolved before a division can be assigned.")}
        <div class="team-eligibility-card manual"><span>Level review required</span><strong>${esc(decision.label)}</strong><p>${esc(decision.reason)}</p></div>
        ${placementSummaryMarkup(decision)}
        <div class="config-alert"><strong>Complete the missing level information first.</strong><br>Once both players have a usable level and the category can be determined, the system will assign the division automatically.</div>`;
    }
    if(decision.categoryPending){
      return `${stepHeading("04 · Division","Category verification required.","Your level is known, but the doubles category cannot be determined automatically from the player information provided.")}
        <div class="team-eligibility-card manual"><span>Category pending</span><strong>${esc(decision.categoryLabel||"Organizer review required")}</strong><p>${esc(decision.reason)}</p></div>
        ${placementSummaryMarkup(decision)}
        <div class="config-alert"><strong>No category selection is shown to the player.</strong><br>The tournament committee will assign the correct category before approval and payment.</div>`;
    }
    const exact=divs[0];
    const cap=exact?divisionCapacityState(exact):null;
    const assigned=exact&&!cap?.full;
    return `${stepHeading("04 · Division","Your division is determined automatically.","Both player level and gender combination are used to assign the correct tournament division.")}
      <div class="team-eligibility-card ${decision.manualReview?"manual":"success"}"><span>${decision.manualReview?"Provisional same-level pair":"Verified same-level pair"}</span><strong>${esc(duprLevelLabel(decision.levelKey))} · ${esc(decision.categoryLabel)}</strong><p>${decision.manualReview?"One or more player levels are still subject to organizer validation. ":""}Both partners are currently in the same level.</p></div>
      ${placementSummaryMarkup(decision)}
      ${!exact?`<div class="config-alert"><strong>No matching division is configured.</strong><br>There is no enabled ${esc(duprLevelLabel(decision.levelKey))} ${esc(decision.categoryLabel)} division. Please contact the organizer.</div>`:
      cap.full?`<div class="config-alert"><strong>${esc(exact.name)} is full.</strong><br>This pair cannot proceed to payment while the division has no available slots.</div>`:
      `<div class="subsection"><div class="subsection-heading"><div><h3>Assigned division</h3><p>No manual division selection is needed.</p></div><button type="button" class="inline-link" data-modal="eligibility">View level rules</button></div><div class="choice-grid"><article class="division-card selected static-card"><strong>${esc(exact.name)}</strong><p>${esc(exact.description||exact.classification||"")}</p><div class="card-meta"><span class="meta-chip">Automatically assigned</span><span class="meta-chip">${money(exact.fee)} / player</span></div></article></div></div>`}`;
  }
  function currentParticipantCount(){return state.registrationType==="individual"?1:2}
  function calcFees(){
    let total=0, unknown=false;const lines=[];const participants=currentParticipantCount();
    state.divisions.forEach(id=>{const d=getDivision(id);if(!d)return;const unit=d.fee;if(unit==null){unknown=true;lines.push([d.name,null]);return}const lineTotal=Number(unit)*participants;total+=lineTotal;lines.push([`${d.name} · ${participants} player${participants===1?"":"s"} × ${money(unit)}`,lineTotal])});
    return {total:unknown?null:total,lines};
  }
  function renderPayment(){
    const decision=teamEligibilityDecision();
    const paymentOnHold=decision.classificationPending||decision.partnerPending||decision.categoryPending||decision.levelMismatch||!state.divisions.length;
    if(paymentOnHold){
      return `${stepHeading("05 · Payment","Payment is on hold.","We do not collect payment until the team level and final division are resolved.")}
        <div class="team-eligibility-card manual"><span>Payment not required yet</span><strong>Level / division verification pending</strong><p>Submit this registration for organizer review. Once the team is classified into the same level and a division is assigned, payment can be completed under the organizer-approved process.</p></div>`;
    }
    const methods=config.paymentMethods.filter(m=>m.enabled);const fees=calcFees();
    return `${stepHeading("05 · Payment","Review the fee before paying.","Charges stay visible before submission. Payment only becomes verified after organizer review.")}
      <div class="fee-box">${fees.lines.length?fees.lines.map(([n,f])=>`<div class="fee-line"><span>${esc(n)}</span><strong>${money(f)}</strong></div>`).join(""):`<div class="fee-line"><span>Registration fee</span><strong>[REGISTRATION_FEE]</strong></div>`}<div class="fee-total"><span>Total</span><strong>${money(fees.total)}</strong></div></div>
      <div class="subsection"><div class="subsection-heading"><div><h3>Payment method</h3><p>Only organizer-approved methods are shown.</p></div></div>${!methods.length?`<div class="config-alert"><strong>Payment configuration required.</strong><br>No payment method is enabled yet. Configure the approved account details before accepting public payments.</div>`:`<div class="choice-grid">${methods.map(m=>`<button type="button" class="choice-card ${state.payment.method===m.id?"selected":""}" data-payment="${esc(m.id)}"><strong>${esc(m.label)}</strong><p>${esc(m.accountName)} · ${esc(m.accountNumber)}</p></button>`).join("")}</div>`}</div>
      ${state.payment.method?paymentDetails(methods.find(m=>m.id===state.payment.method)):""}`;
  }
  function paymentDetails(m){if(!m)return"";return `<div class="subsection"><div class="subsection-heading"><div><h3>${esc(m.label)} instructions</h3><p>${esc(m.instructions)}</p></div><button type="button" class="inline-link" data-copy="${esc(m.accountNumber)}">Copy Account Number</button></div><div class="form-grid">${field("payment","reference","Payment Reference Number",state.payment.reference,"text","off",false)}${field("payment","senderName","Account / Sender Name",state.payment.senderName,"text","name",false)}${field("payment","amountPaid","Amount Paid",state.payment.amountPaid,"number","off",false)}${field("payment","paymentDate","Payment Date",state.payment.paymentDate,"date","off",false)}</div><div class="file-drop" style="margin-top:18px"><label for="paymentFile">Upload Proof of Payment</label><p>JPG, PNG, or PDF. File contents are not stored in local autosave.</p><input id="paymentFile" type="file" accept="image/jpeg,image/png,application/pdf"/>${state.payment.fileName?`<div class="file-confirm">✓ ${esc(state.payment.fileName)}</div>`:""}</div><p class="submit-note">Uploading proof sets the registration to <strong>Payment Submitted</strong>, not Payment Verified.</p></div>`}
  function renderConsent(){return `${stepHeading("06 · Waiver & consent","Review the acknowledgements.","Consent is never pre-selected. Expand the organizer-approved full waiver before submission when required.")}<div class="consent-list">${consent("rules","Tournament rules & eligibility","I acknowledge the organizer-approved tournament rules and eligibility requirements.",true)}${consent("risk","Assumption of risk","I acknowledge the organizer-approved assumption of risk and medical responsibility terms.",true)}${consent("privacy","Data privacy","I consent to the tournament processing the information required for official event operations.",true)}${consent("accuracy","Information accuracy & level verification","I confirm that my DUPR status, rating, club affiliation, and playing history are accurate. I understand that inaccurate or misleading information may result in reclassification, rejection, or disqualification.",true)}${consent("media","Photography / video","I acknowledge the organizer-approved photography/video policy where applicable.",false)}</div><button type="button" class="button button-ghost" style="margin-top:18px" data-modal="waiver">Read Full Waiver</button>`}
  function consent(key,title,copy,required){return `<label class="consent-option"><input type="checkbox" name="consent.${key}" ${state.consents[key]?"checked":""} ${required?"required":""}/><span><strong>${esc(title)}${required?" *":""}</strong><small>${esc(copy)}</small></span></label>`}
  function reviewPlayerCard(player,verification,label,editStep){
    const fullName=[player?.firstName,player?.middleName,player?.lastName].filter(Boolean).join(" ").trim()||"—";
    const eligibility=verificationEligibility(verification||{});
    const level=eligibility.levelKey?duprLevelLabel(eligibility.levelKey):"Pending";
    const basis=verification?.hasDupr==="Yes"
      ? (eligibility.rating!=null?`DUPR ${Number(eligibility.rating).toFixed(2)}`:"DUPR rating pending")
      : verification?.hasDupr==="No"
        ? "No DUPR · player-requested level"
        : "Level information pending";
    const verificationStatus=verification?.hasDupr==="Yes"
      ? (eligibility.verified?"DUPR proof verified":"DUPR proof pending organizer review")
      : verification?.hasDupr==="No"
        ? (verification?.manualLevelApproved?"Level validated by organizer":"Requested level subject to organizer validation")
        : "Pending";
    return `<article class="review-player-card">
      <div class="review-player-head">
        <div>
          <span class="review-card-kicker">${esc(label)}</span>
          <h3>${esc(fullName)}</h3>
        </div>
        <button class="review-edit" type="button" data-edit-step="${editStep}">Edit</button>
      </div>
      <div class="review-player-status">
        <span class="review-chip">${esc(player?.gender||"Gender pending")}</span>
        <span class="review-chip">${esc(level)}</span>
        <span class="review-chip ${eligibility.manual&&!eligibility.verified?"review-chip-warning":""}">${eligibility.manual&&!eligibility.verified?"Needs validation":"Level ready"}</span>
      </div>
      <dl class="review-detail-list">
        <div><dt>Club</dt><dd>${esc(verification?.clubAffiliation||"—")}</dd></div>
        <div><dt>Level basis</dt><dd>${esc(basis)}</dd></div>
        <div><dt>Verification</dt><dd>${esc(verificationStatus)}</dd></div>
        <div><dt>Jersey name</dt><dd>${esc(verification?.jerseyName||"—")}</dd></div>
        <div><dt>Mobile</dt><dd>${esc(formatMobile(player?.mobile)||"—")}</dd></div>
        <div><dt>Email</dt><dd>${esc(player?.email||"—")}</dd></div>
      </dl>
    </article>`;
  }

  function reviewPartnerPlaceholder(){
    if(state.registrationType==="invite"){
      const name=[state.player2.firstName,state.player2.lastName].filter(Boolean).join(" ").trim()||"Invited partner";
      return `<article class="review-player-card review-player-card-pending">
        <div class="review-player-head"><div><span class="review-card-kicker">PARTNER</span><h3>${esc(name)}</h3></div><button class="review-edit" type="button" data-edit-step="2">Edit</button></div>
        <div class="review-player-status"><span class="review-chip review-chip-warning">Awaiting partner</span></div>
        <p class="review-card-note">Final level, gender category, and division will be determined after your partner completes their information.</p>
        <dl class="review-detail-list">
          <div><dt>Email</dt><dd>${esc(state.player2.email||"—")}</dd></div>
          <div><dt>Mobile</dt><dd>${esc(formatMobile(state.player2.mobile)||"—")}</dd></div>
        </dl>
      </article>`;
    }
    if(state.registrationType==="existing"){
      return `<article class="review-player-card review-player-card-pending">
        <div class="review-player-head"><div><span class="review-card-kicker">PARTNER</span><h3>Existing registration</h3></div><button class="review-edit" type="button" data-edit-step="2">Edit</button></div>
        <div class="review-player-status"><span class="review-chip review-chip-warning">Link pending</span></div>
        <dl class="review-detail-list"><div><dt>Reference</dt><dd>${esc(state.partnerReference||"—")}</dd></div></dl>
      </article>`;
    }
    return "";
  }

  function reviewPlacementCard(decision){
    const p1=verificationEligibility(state.verification1||{});
    const p2=verificationEligibility(state.verification2||{});
    const p1Level=p1.levelKey?duprLevelLabel(p1.levelKey):"Pending";
    const p2Level=p2.levelKey?duprLevelLabel(p2.levelKey):"Pending";
    const g1=state.player1?.gender||"Pending";
    const g2=state.player2?.gender||"Pending";
    const divisionName=state.divisions.map(id=>getDivision(id)?.name).filter(Boolean)[0]||"Pending";
    const category=decision.categoryLabel||"Pending";
    const levelResult=decision.levelMismatch
      ? `${p1Level} + ${p2Level} → Mismatch`
      : decision.levelKey
        ? `${p1Level} + ${p2Level} → ${duprLevelLabel(decision.levelKey)}`
        : `${p1Level} + ${p2Level}`;
    const categoryResult=decision.categoryPending
      ? `${g1} + ${g2} → Pending`
      : `${g1} + ${g2} → ${category}`;
    return `<section class="review-card review-placement-card">
      <div class="review-card-head">
        <div><span class="review-card-kicker">PLACEMENT</span><h3>Why this division?</h3><p>The system checks the pair's level first, then uses gender to determine the category.</p></div>
        <button class="review-edit" type="button" data-edit-step="3">Review division</button>
      </div>
      <div class="review-rule-grid">
        <div class="review-rule">
          <span>Level check</span>
          <strong>${esc(levelResult)}</strong>
          <small>${decision.levelMismatch?"Both partners must be in the same tournament tier.":"Same-tier requirement satisfied based on the submitted level information."}</small>
        </div>
        <div class="review-rule">
          <span>Category check</span>
          <strong>${esc(categoryResult)}</strong>
          <small>Male + Male = Men's · Female + Female = Women's · Male + Female = Mixed.</small>
        </div>
      </div>
      <div class="review-assigned-division">
        <div><span>Assigned division</span><strong>${esc(divisionName)}</strong></div>
        <span class="review-chip ${decision.manualReview?"review-chip-warning":""}">${decision.manualReview?"Subject to organizer validation":"Placement ready"}</span>
      </div>
    </section>`;
  }

  function reviewPaymentCard(paymentHeld,fees){
    const method=paymentLabel(state.payment.method)||"Not selected";
    const proof=state.payment.fileName||"No proof uploaded";
    const status=paymentHeld
      ? "Payment on hold"
      : state.payment.fileName
        ? "Proof ready for organizer review"
        : "Payment details incomplete";
    return `<section class="review-card">
      <div class="review-card-head">
        <div><span class="review-card-kicker">PAYMENT</span><h3>${paymentHeld?"Payment not required yet":money(fees.total)}</h3><p>${esc(status)}</p></div>
        <button class="review-edit" type="button" data-edit-step="4">Edit</button>
      </div>
      <dl class="review-detail-list compact">
        ${paymentHeld
          ? `<div><dt>Status</dt><dd>On hold until placement is finalized</dd></div>`
          : `<div><dt>Fee basis</dt><dd>${esc(`${money(enabledDivisions()[0]?.fee??1800)} per player`)}</dd></div>
             <div><dt>Method</dt><dd>${esc(method)}</dd></div>
             <div><dt>Proof</dt><dd>${esc(proof)}</dd></div>`}
      </dl>
    </section>`;
  }

  function reviewConsentCard(){
    const complete=requiredConsentsComplete();
    return `<section class="review-card">
      <div class="review-card-head">
        <div><span class="review-card-kicker">CONSENT</span><h3>${complete?"Required acknowledgements complete":"Consent incomplete"}</h3><p>${complete?"You confirmed the required tournament, privacy, risk, and accuracy acknowledgements.":"Complete all required acknowledgements before submitting."}</p></div>
        <button class="review-edit" type="button" data-edit-step="5">Edit</button>
      </div>
      <div class="review-consent-status ${complete?"complete":""}">
        <span aria-hidden="true">${complete?"✓":"!"}</span>
        <strong>${complete?"Ready":"Needs attention"}</strong>
      </div>
    </section>`;
  }

  function renderReview(){
    const fees=calcFees();
    const decision=teamEligibilityDecision();
    const paymentHeld=decision.classificationPending||decision.partnerPending||decision.categoryPending||decision.levelMismatch||!state.divisions.length;
    const divisionName=state.divisions.map(id=>getDivision(id)?.name).filter(Boolean)[0]||"Division pending";
    const pairReady=!decision.levelMismatch&&!decision.classificationPending&&!decision.partnerPending&&!decision.categoryPending;
    const reviewState=decision.manualReview
      ? "Ready for organizer review"
      : pairReady
        ? "Ready to submit"
        : "Submission needs attention";
    const reviewCopy=decision.manualReview
      ? "Your entry can be submitted now. The organizer will validate the flagged level information before final approval."
      : pairReady
        ? "Everything needed for this entry is in place. Check the details below, then submit."
        : "One or more placement details still need to be resolved before this entry can be finalized.";
    const playerCards=state.registrationType==="pair"
      ? `${reviewPlayerCard(state.player1,state.verification1,"PLAYER 1",1)}${reviewPlayerCard(state.player2,state.verification2,"PLAYER 2",2)}`
      : `${reviewPlayerCard(state.player1,state.verification1,"PLAYER 1",1)}${reviewPartnerPlaceholder()}`;

    return `${stepHeading("07 · Final review","Confirm your tournament entry.","Check the important details below. Use Edit if anything is incorrect before you submit.")}
      <section class="review-hero ${decision.manualReview?"review-hero-warning":""}">
        <div>
          <span class="review-card-kicker">${decision.manualReview?"ORGANIZER VALIDATION":"FINAL CHECK"}</span>
          <h3>${esc(reviewState)}</h3>
          <p>${esc(reviewCopy)}</p>
        </div>
        <div class="review-hero-division">
          <span>Current division</span>
          <strong>${esc(divisionName)}</strong>
        </div>
      </section>

      <div class="review-overview-grid">
        <div class="review-overview-item"><span>Registration</span><strong>${esc(typeLabel(state.registrationType))}</strong></div>
        <div class="review-overview-item"><span>Team level</span><strong>${esc(decision.levelKey?duprLevelLabel(decision.levelKey):decision.levelMismatch?"Level mismatch":"Pending")}</strong></div>
        <div class="review-overview-item"><span>Category</span><strong>${esc(decision.categoryLabel||"Pending")}</strong></div>
        <div class="review-overview-item"><span>Fee</span><strong>${paymentHeld?"On hold":money(fees.total)}</strong></div>
      </div>

      <div class="review-group-head">
        <div><span class="review-card-kicker">PLAYERS</span><h3>Player details</h3><p>These are the details the organizer will use for tournament operations and eligibility review.</p></div>
      </div>
      <div class="review-player-grid">${playerCards}</div>

      ${reviewPlacementCard(decision)}

      <div class="review-two-column">
        ${reviewPaymentCard(paymentHeld,fees)}
        ${reviewConsentCard()}
      </div>

      <section class="review-submit-note">
        <div class="review-submit-icon" aria-hidden="true">✓</div>
        <div>
          <strong>Before you submit</strong>
          <p>${decision.manualReview
            ?"No-DUPR or unverified DUPR information remains subject to organizer validation. The organizer may approve, reclassify, or decline the entry if the submitted information does not support the requested level."
            :"Submitting sends these details to the tournament organizer for registration processing and final approval."}</p>
        </div>
      </section>`;
  }

  function duprReview(data){
    if(!data?.hasDupr)return "—";
    if(data.hasDupr==="No"){
      return data.organizerAssignedLevel&&data.manualLevelApproved
        ? `No DUPR · Validated ${duprLevelLabel(data.organizerAssignedLevel)}`
        : data.requestedLevel
          ? `No DUPR · Requested ${duprLevelLabel(data.requestedLevel)} · Pending organizer validation`
          : "No DUPR · Requested level missing";
    }
    const result=classifyDuprRating(data.duprRating);
    return [data.duprRating?`DUPR ${Number(data.duprRating).toFixed(2)}`:"",result?.label?`Provisional ${result.label}`:"",data.duprProofName?`Proof: ${data.duprProofName}`:"Proof missing",data.duprId||""].filter(Boolean).join(" · ")||"DUPR declared";
  }
  function typeLabel(id){return config.registrationTypes.find(t=>t.id===id)?.label||"—"}
  function paymentLabel(id){return config.paymentMethods.find(t=>t.id===id)?.label||""}
  function requiredConsentsComplete(){return ["rules","risk","privacy","accuracy"].every(k=>state.consents[k])}

  function bindStepEvents(){
    $$('[data-type]').forEach(btn=>btn.onclick=()=>{state.registrationType=btn.dataset.type;state.divisions=[];renderStep()});
    $$('[data-payment]').forEach(btn=>btn.onclick=()=>{state.payment.method=btn.dataset.payment;renderStep()});
    $$('[data-copy]').forEach(btn=>btn.onclick=async()=>{try{await navigator.clipboard.writeText(btn.dataset.copy);showToast("Account number copied")}catch{showToast("Copy unavailable")}});
    $$('[data-modal]').forEach(btn=>btn.onclick=()=>openModal(btn.dataset.modal));
    $$('[data-edit-step]').forEach(btn=>btn.onclick=()=>{state.step=Number(btn.dataset.editStep);renderStep()});
    $$('input[name], select[name], textarea[name]').forEach(input=>{
      input.addEventListener('input',()=>{
        captureInput(input);
        if(input.name.endsWith('.duprRating')||input.name.endsWith('.requestedLevel')||input.name.endsWith('.gender')){state.divisions=[];updateEligibilityOutputs();}
      });
      input.addEventListener('change',()=>{
        captureInput(input);
        if(input.name.endsWith('.hasDupr')){
          const [group]=input.name.split('.');
          if(input.value==="Yes"){
            state[group].verificationReference="";
            state[group].playingBackground="";
            state[group].requestedLevel="";
            state[group].organizerAssignedLevel="";
            state[group].manualLevelApproved=false;
          }else if(input.value==="No"){
            state[group].duprId="";
            state[group].duprRating="";
            state[group].duprProofName="";
            state[group].duprProofType="";
            state[group].duprProofDataUrl="";
            state[group].duprProofStatus="";
            state[group].organizerAssignedLevel="";
            state[group].manualLevelApproved=false;
            if(group==="verification2"){
              const player1Level=verificationEligibility(state.verification1).levelKey||"";
              state[group].requestedLevel=player1Level;
            }
          }
          state.divisions=[];
          renderStep();
        }else if(input.name.endsWith('.duprRating')||input.name.endsWith('.requestedLevel')||input.name.endsWith('.gender')){
          state.divisions=[];
          updateEligibilityOutputs();
        }
      });
      if(input.type==='tel') input.addEventListener('input',()=>{input.value=formatMobile(input.value)});
    });
    $$('[data-dupr-proof]').forEach(input=>input.onchange=()=>handleDuprProof(input));
    const file=$("#paymentFile");if(file)file.onchange=()=>handleFile(file);
  }
  function captureInput(input){
    const [group,key]=input.name.split('.'); if(!key)return;
    const value=input.type==='checkbox'?input.checked:input.value;
    if(group==='consent')state.consents[key]=value;
    else if(group==='partner')state.partnerReference=value;
    else {state[group] ||= {};state[group][key]=input.type==='tel'?normalizeMobile(value):value;}
    saveDraft();
  }
  function toggleDivision(id){
    if(state.divisions.includes(id)){state.divisions=state.divisions.filter(x=>x!==id)}
    else {const max=config.multipleDivisionRules.allowed?config.multipleDivisionRules.maxDivisionsPerPlayer:1;if(state.divisions.length>=max){showToast(`Maximum ${max} division(s) allowed`);return}state.divisions.push(id)}
    renderStep();
  }
  function compressProofImage(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error("Unable to read image"));
      reader.onload=()=>{
        const img=new Image();
        img.onerror=()=>reject(new Error("Invalid image"));
        img.onload=()=>{
          const maxSide=1400;
          const scale=Math.min(1,maxSide/Math.max(img.width,img.height));
          const canvas=document.createElement("canvas");
          canvas.width=Math.max(1,Math.round(img.width*scale));
          canvas.height=Math.max(1,Math.round(img.height*scale));
          const ctx=canvas.getContext("2d");
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          resolve(canvas.toDataURL("image/jpeg",0.76));
        };
        img.src=reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  async function handleDuprProof(input){
    const file=input.files?.[0]; if(!file)return;
    const prefix=input.dataset.duprProof;
    if(!["image/jpeg","image/png"].includes(file.type)){input.value="";showToast("DUPR proof must be a JPG or PNG screenshot");return}
    if(file.size>8*1024*1024){input.value="";showToast("DUPR screenshot is too large. Maximum 8 MB");return}
    try{
      input.disabled=true;
      const dataUrl=await compressProofImage(file);
      state[prefix] ||= {};
      state[prefix].duprProofName=file.name;
      state[prefix].duprProofType="image/jpeg";
      state[prefix].duprProofDataUrl=dataUrl;
      state[prefix].duprProofStatus="Pending Verification";
      state.divisions=[];
      saveDraft();
      renderStep();
      showToast("DUPR screenshot added");
    }catch(e){
      console.warn(e);
      input.disabled=false;
      showToast("We could not process that screenshot");
    }
  }
  function handleFile(input){
    const file=input.files?.[0]; if(!file)return; const allowed=['image/jpeg','image/png','application/pdf'];
    if(!allowed.includes(file.type)){input.value='';showToast('Please upload a JPG, PNG, or PDF');return}
    if(file.size>8*1024*1024){input.value='';showToast('File is too large. Maximum 8 MB');return}
    state.payment.fileName=file.name;state.payment.fileType=file.type;saveDraft();renderStep();
  }

  function validateStep(){
    clearErrors();let errors=[];
    if(state.step===0){if(!state.registrationType)errors.push('Choose a registration type.');}
    if(state.step===1){
      errors.push(...validatePlayer('player1',state.player1));
      errors.push(...validateVerification('verification1',state.verification1,'Player 1'));
    }
    if(state.step===2){
      if(state.registrationType==='pair'){
        errors.push(...validatePlayer('player2',state.player2));
        errors.push(...validateVerification('verification2',state.verification2,'Player 2'));
      }
      if(state.registrationType==='invite')errors.push(...validateInvite());
      if(state.registrationType==='existing'&&!state.partnerReference.trim())errors.push('Enter the partner registration reference.');
    }
    if(state.step===3){
      sanitizeDivisionSelection();
      const decision=teamEligibilityDecision();
      if(decision.levelMismatch)errors.push('Player levels do not match. Both partners must be in the same tournament level.');
      if(!decision.levelMismatch&&!decision.classificationPending&&!decision.partnerPending&&!decision.categoryPending){
        const divs=eligibleDivisions();
        if(!divs.length)errors.push('No enabled division matches this level and gender category.');
        else if(divisionCapacityState(divs[0]).full)errors.push('The automatically assigned division is full.');
        else if(state.divisions.length!==1)errors.push('The tournament division could not be assigned automatically.');
      }
    }
    if(state.step===4){/* Payment is intentionally skipped while level/division verification is pending. */}
    if(state.step===5 && !requiredConsentsComplete())errors.push('Complete all required acknowledgements before continuing.');
    if(errors.length){showToast(errors[0]);focusFirstError();return false}return true;
  }
  function validatePlayer(prefix,p){
    const errors=[]; const req=['firstName','lastName','displayName','gender','birthDate','mobile','email'];
    req.forEach(k=>{if(!String(p[k]||'').trim()){markInvalid(`${prefix}.${k}`,`${labelFor(k)} is required.`);errors.push(`${labelFor(k)} is required.`)}});
    if(p.email&&!validEmail(p.email)){markInvalid(`${prefix}.email`,'Enter a valid email address.');errors.push('Enter a valid email address.')}
    if(p.mobile&&!validMobile(p.mobile)){markInvalid(`${prefix}.mobile`,'Use a Philippine mobile number such as 09XX XXX XXXX.');errors.push('Enter a valid Philippine mobile number.')}
    return errors;
  }
  function validateInvite(){const e=[];['firstName','lastName','email','mobile'].forEach(k=>{if(!String(state.player2[k]||'').trim()){markInvalid(`player2.${k}`,`${labelFor(k)} is required.`);e.push('Complete all required partner invitation details.')}});if(state.player2.email&&!validEmail(state.player2.email)){markInvalid('player2.email','Enter a valid email address.');e.push('Enter a valid partner email.')}if(state.player2.mobile&&!validMobile(state.player2.mobile)){markInvalid('player2.mobile','Use a Philippine mobile number.');e.push('Enter a valid partner mobile.')}return e}
  function validateVerification(prefix,data,playerLabel){
    const e=[];
    for(const [key,label] of [['clubAffiliation','Club Affiliation'],['jerseyName','Jersey back name'],['hasDupr','DUPR status']]){
      if(!String(data?.[key]||'').trim()){markInvalid(`${prefix}.${key}`,`${label} is required.`);e.push(`${playerLabel}: ${label} is required.`)}
    }
    if(data?.hasDupr==='Yes'){
      const rating=Number(data.duprRating);
      if(!String(data.duprRating??'').trim()||!Number.isFinite(rating)||rating<=0||rating>8){
        markInvalid(`${prefix}.duprRating`,'Enter a valid DUPR rating between 0.01 and 8.00.');
        e.push(`${playerLabel}: enter a valid DUPR rating.`);
      }
      if(!data.duprProofName||!data.duprProofDataUrl){
        markInvalid(`${prefix}.duprProof`,'Upload a DUPR screenshot showing your name and current rating.');
        e.push(`${playerLabel}: DUPR screenshot proof is required.`);
      }
    }
    if(data?.hasDupr==='No'){
      if(!String(data.requestedLevel||'').trim()){
        markInvalid(`${prefix}.requestedLevel`,'Select the playing level you are requesting.');
        e.push(`${playerLabel}: requested playing level is required.`);
      }
      if(!String(data.verificationReference||'').trim()){
        markInvalid(`${prefix}.verificationReference`,"Paste your club's DUPR page or official Facebook page link.");
        e.push(`${playerLabel}: club DUPR / Facebook page link is required.`);
      }else if(!validClubPageUrl(data.verificationReference)){
        markInvalid(`${prefix}.verificationReference`,"Use a valid DUPR or Facebook URL, including https://.");
        e.push(`${playerLabel}: enter a valid club DUPR or Facebook page link.`);
      }
      if(!String(data.playingBackground||'').trim()){
        markInvalid(`${prefix}.playingBackground`,'Provide your playing background and recent tournament history.');
        e.push(`${playerLabel}: playing background is required for level validation.`);
      }
    }
    return e;
  }
  function labelFor(k){return ({firstName:'First name',lastName:'Last name',displayName:'Display name',gender:'Gender',birthDate:'Birth date',mobile:'Mobile number',email:'Email address'})[k]||k}
  function markInvalid(name,msg){const el=$(`[data-field="${CSS.escape(name)}"]`);if(el){el.classList.add('invalid');const err=$('.field-error',el);if(err)err.textContent=msg}}
  function clearErrors(){$$('.field.invalid').forEach(el=>el.classList.remove('invalid'));$$('.field-error').forEach(el=>el.textContent='')}
  function focusFirstError(){const el=$('.field.invalid input,.field.invalid select');if(el){el.focus();el.scrollIntoView({behavior:'smooth',block:'center'})}}

  function sameParticipant(a,b){
    if(!a||!b)return false;
    const emailA=String(a.email||'').trim().toLowerCase(),emailB=String(b.email||'').trim().toLowerCase();
    const mobileA=normalizeMobile(a.mobile),mobileB=normalizeMobile(b.mobile);
    if(emailA&&emailB&&emailA===emailB)return true;
    if(mobileA&&mobileB&&mobileA===mobileB)return true;
    const nameA=[a.firstName,a.lastName].filter(Boolean).join(' ').trim().toLowerCase();
    const nameB=[b.firstName,b.lastName].filter(Boolean).join(' ').trim().toLowerCase();
    return !!(nameA&&nameB&&a.birthDate&&b.birthDate&&nameA===nameB&&a.birthDate===b.birthDate);
  }
  function findDuplicate(){
    const current=[state.player1];if(state.registrationType==='pair')current.push(state.player2);
    return getRecords().find(r=>current.some(candidate=>[r.player1,r.player2].some(existing=>sameParticipant(candidate,existing))));
  }
  function submitRegistration(){
    if(state.submitted)return;
    if(!validateAll())return;
    const dup=findDuplicate();
    if(dup){openDuplicateModal(dup);return}
    const btn=$("#nextButton");btn.disabled=true;btn.textContent='Submitting…';
    state.reference=`APC26-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
    sanitizeDivisionSelection();
    const decision=teamEligibilityDecision();
    const paymentHeld=decision.classificationPending||decision.partnerPending||decision.categoryPending||!state.divisions.length;
    state.status=state.registrationType==='invite'?'Awaiting Partner':
      paymentHeld?'Pending Level Validation':
      decision.manualReview?'Pending Level Validation':
      state.payment.fileName?'Payment Submitted':'Submitted';
    state.submitted=true;
    const record={...structuredClone(state),eligibilitySnapshot:buildEligibilitySnapshot(),paymentHeld,submittedAt:new Date().toISOString(),lookupIdentity:{email:(state.player1.email||'').toLowerCase(),mobile:normalizeMobile(state.player1.mobile)}};
    try{
      saveRecord(record);
    }catch(e){
      console.warn("Full proof image could not be stored locally; saving proof metadata only.",e);
      if(record.verification1)record.verification1.duprProofDataUrl="";
      if(record.verification2)record.verification2.duprProofDataUrl="";
      saveRecord(record);
    }
    localStorage.removeItem(STORAGE_KEY);
    renderConfirmation();showView('confirmation');btn.disabled=false;btn.textContent='Submit Registration';
  }
  function validateAll(){
    const original=state.step;
    for(const s of [0,1,2,3,5]){
      state.step=s;renderStep();
      if(!validateStep()){showToast(`Please complete ${stepDefs[s][1]} before submitting.`);return false}
    }
    state.step=original;renderStep();return true;
  }

  function openDuplicateModal(record){
    const modal=$("#modal");$("#modalBody").innerHTML=`<p class="eyebrow">Possible duplicate</p><h2>We may already have a registration matching these details.</h2><p>To protect participant records, this submission has not been duplicated.</p><div class="choice-grid" style="margin-top:20px"><button class="button button-primary" id="dupView">Check Existing Registration</button><button class="button button-ghost" id="dupDifferent">Use Different Information</button></div>`;modal.showModal();$("#dupView").onclick=()=>{modal.close();showView('lookup');$("#lookupReference").value=record.reference||'';$("#lookupIdentity").value=state.player1.email||state.player1.mobile||''};$("#dupDifferent").onclick=()=>{modal.close();state.step=1;renderStep()};
  }
  function renderConfirmation(){
    $("#confirmationReference").textContent=state.reference;$("#confirmationStatus").textContent=state.status;
  }
  function openModal(kind){
    const modal=$("#modal");let html='';
    if(kind==='eligibility'){
      const t=duprThresholds();
      html=`<p class="eyebrow">Level eligibility rules</p><h2>How division placement works</h2><p>If you have DUPR, enter your current rating and upload a screenshot showing your name and rating. The system calculates a provisional level and the tournament committee verifies the proof. If you do not have DUPR, choose the level you are requesting and provide your club's DUPR or Facebook page link plus recent playing history. The organizer validates that request before approval.</p><div class="dupr-threshold-list"><div><strong>Beginner</strong><span>Below ${t.lowIntermediateMin.toFixed(2)}</span></div><div><strong>Low Intermediate</strong><span>${t.lowIntermediateMin.toFixed(2)} – ${(t.highIntermediateMin-0.01).toFixed(2)}</span></div><div><strong>High Intermediate</strong><span>${t.highIntermediateMin.toFixed(2)} – ${(t.advancedMin-0.01).toFixed(2)}</span></div><div><strong>Advanced</strong><span>${t.advancedMin.toFixed(2)}+</span></div></div><div class="config-alert"><strong>Pair rule:</strong> Both partners must be in the same tournament level. The system does not automatically move a mismatched pair upward. Gender is limited to Male or Female. Category is assigned automatically: Male/Male = Men's, Female/Female = Women's, Male/Female = Mixed.</div><div class="config-alert" style="margin-top:12px"><strong>No-DUPR validation:</strong> A requested level is provisional. The organizer may approve, reclassify, or reject the registration based on the information provided.</div>`;
    }
    if(kind==='waiver') html=`<p class="eyebrow">Waiver & consent</p><h2>Full tournament waiver</h2><p>${esc(config.waiver.fullText)}</p><p class="submit-note">Waiver version: ${esc(config.waiver.version)}</p>`;
    $("#modalBody").innerHTML=html;modal.showModal();
  }
  function lookup(event){
    event.preventDefault();const ref=$("#lookupReference").value.trim().toUpperCase();const identity=$("#lookupIdentity").value.trim();const normalized=normalizeMobile(identity);const records=getRecords();
    const record=records.find(r=>r.reference===ref&&((r.lookupIdentity.email&&r.lookupIdentity.email===identity.toLowerCase())||(r.lookupIdentity.mobile&&r.lookupIdentity.mobile===normalized)));
    const out=$("#lookupResult");
    if(!record){out.innerHTML=`<div class="lookup-error">We couldn't verify that registration. Check the reference and the email or mobile used during registration.</div>`;return}
    out.innerHTML=`<div class="lookup-result-card"><span class="status-pill">${esc(record.status)}</span><h3>${esc(record.reference)}</h3><p><strong>${esc([record.player1.firstName,record.player1.lastName].filter(Boolean).join(' '))}</strong><br>${esc(record.divisions.map(id=>getDivision(id)?.name).filter(Boolean).join(', '))}</p><p class="submit-note">Sensitive contact, birth-date, and payment details remain hidden in this public lookup summary.</p></div>`;
  }

  function openAdmin(){
    adminDraft=structuredClone(config);
    adminTab="details";
    showView("admin");
    renderAdmin();
  }
  function renderAdmin(){
    $$(".admin-tab").forEach(btn=>btn.classList.toggle("active",btn.dataset.adminTab===adminTab));
    const panel=$("#adminPanel");
    if(adminTab==="details")panel.innerHTML=renderAdminDetails();
    if(adminTab==="divisions")panel.innerHTML=renderAdminDivisions();
    if(adminTab==="hero")panel.innerHTML=renderAdminHero();
    if(adminTab==="faq")panel.innerHTML=renderAdminFaq();
    if(adminTab==="contact")panel.innerHTML=renderAdminContact();
    bindAdminPanel();
  }
  function adminField(label,path,value,type="text",helper=""){
    const shown=adminDisplayValue(value);
    return `<label class="field"><span>${esc(label)}</span><input type="${esc(type)}" data-admin-path="${esc(path)}" value="${esc(shown)}" ${type==="number"?'inputmode="decimal"':''}/>${helper?`<small>${esc(helper)}</small>`:""}</label>`;
  }
  function adminTextarea(label,path,value,helper=""){
    return `<label class="field full"><span>${esc(label)}</span><textarea data-admin-path="${esc(path)}">${esc(adminDisplayValue(value))}</textarea>${helper?`<small>${esc(helper)}</small>`:""}</label>`;
  }
  function renderAdminDetails(){
    return `<div class="admin-panel-heading"><div><p class="eyebrow">Event configuration</p><h2>Core tournament details</h2><p>These values feed the landing page, timeline, registration experience, and participant confirmation.</p></div><span class="status-pill">Live configuration</span></div>
      <div class="admin-form-grid">${adminField("Tournament name","name",adminDraft.name)}${adminField("Organizer","organizer",adminDraft.organizer)}${adminField("Event date","eventDate",adminDraft.eventDate,"date","Used for tournament day and calendar export.")}${adminField("Venue","venue",adminDraft.venue)}${adminField("Registration opens","registrationOpening",adminDraft.registrationOpening,"date")}${adminField("Registration deadline","registrationDeadline",adminDraft.registrationDeadline,"date")}${adminField("Final player confirmation","finalPlayerConfirmation",adminDraft.finalPlayerConfirmation,"date")}${adminField("Schedule release","scheduleRelease",adminDraft.scheduleRelease,"date")}${adminField("Number of courts","numberOfCourts",adminDraft.numberOfCourts,"number")}${adminField("Confirmed participants (public count)","publicStats.confirmedParticipantsOverride",adminDraft.publicStats?.confirmedParticipantsOverride,"number","Number only. Leave blank to derive from records whose status is Confirmed. Use an override only for this standalone preview or roster migration.")}${adminTextarea("Participant eligibility","eligibilitySummary",adminDraft.eligibilitySummary,"Shown in tournament details and registration guidance.")}${adminTextarea("Tournament format summary","formatSummary",adminDraft.formatSummary,"Keep this concise and organizer-approved.")}</div>`;
  }
  function renderAdminDivisions(){
    const divisions=adminDraft.divisions||[];
    return `<div class="admin-panel-heading"><div><p class="eyebrow">Registration architecture</p><h2>Divisions, fees & capacity</h2><p>Registration is PHP 1,800 per player. Set each division’s team capacity and participant ceiling; double entry remains disabled globally.</p></div><button class="button button-ghost" id="addDivisionButton" type="button">+ Add Division</button></div>
      <div class="admin-division-list">${divisions.length?divisions.map((d,i)=>`<article class="admin-division-card"><header><div><span class="admin-index">${String(i+1).padStart(2,"0")}</span><strong>${esc(d.name||"Untitled division")}</strong></div><div class="admin-card-actions"><label class="switch-label"><input type="checkbox" data-division-index="${i}" data-division-field="enabled" ${d.enabled?"checked":""}/> Enabled</label><button class="icon-button danger" type="button" data-remove-division="${i}" aria-label="Remove division">×</button></div></header><div class="admin-form-grid compact">${adminDivisionField(i,"Division name","name",d.name)}${adminDivisionField(i,"Classification","classification",d.classification)}${adminDivisionField(i,"Description","description",d.description)}${adminDivisionField(i,"Eligibility","eligibility",d.eligibility)}${adminDivisionField(i,"Fee per player","fee",d.fee,"number")}${adminDivisionField(i,"Maximum participants","maxParticipants",d.maxParticipants,"number")}${adminDivisionField(i,"Capacity (pair / team slots)","capacity",d.capacity,"number")}${adminDivisionField(i,"Team slots remaining","slotsRemaining",d.slotsRemaining,"number")}</div></article>`).join(""):`<div class="empty-state"><strong>No divisions yet.</strong>Add the first organizer-approved division to open registration.</div>`}</div>`;
  }
  function adminDivisionField(index,label,fieldName,value,type="text"){
    return `<label class="field"><span>${esc(label)}</span><input type="${type}" data-division-index="${index}" data-division-field="${esc(fieldName)}" value="${esc(value??"")}"/></label>`;
  }
  function renderAdminHero(){
    const slides=adminDraft.heroCarousel?.slides||[];
    return `<div class="admin-panel-heading"><div><p class="eyebrow">Homepage hero</p><h2>Campaign carousel</h2><p>Build full-bleed editorial slides with oversized type, compact pill actions, and image-first composition. Landscape imagery around 16:9 or wider works best.</p></div><button class="button button-ghost" id="addHeroSlideButton" type="button" ${slides.length>=5?"disabled":""}>+ Add Slide</button></div>
      <div class="admin-inline-settings">${adminField("Autoplay interval (ms)","heroCarousel.autoplayMs",adminDraft.heroCarousel?.autoplayMs||6500,"number","Recommended: 5500–8000 ms.")}</div>
      <div class="admin-hero-list">${slides.map((slide,i)=>`<article class="admin-hero-card"><div class="admin-hero-preview campaign-preview ${slide.contentPosition==="left"?"align-left":""}" ${slide.image?`style="background-image:linear-gradient(180deg,rgba(0,0,0,.03),rgba(0,0,0,.5)),url('${esc(slide.image)}');background-position:${esc(slide.imagePosition||"center")}"`:""}><span>${esc(slide.eyebrow||"Hero slide")}</span><strong>${nl2br(slide.headline||"Untitled slide")}</strong><small>${esc(slide.primaryCtaLabel||"Register Now")}</small></div><header><div><span class="admin-index">Slide ${i+1}</span><strong>${esc((slide.headline||"Untitled slide").split("\n")[0])}</strong></div><button class="icon-button danger" type="button" data-remove-hero="${i}" ${slides.length<=1?"disabled":""} aria-label="Remove hero slide">×</button></header><div class="admin-form-grid compact">${adminHeroField(i,"Eyebrow","eyebrow",slide.eyebrow)}${adminHeroField(i,"Headline","headline",slide.headline)}${adminHeroField(i,"Supporting copy","body",slide.body)}${adminHeroField(i,"Primary CTA label","primaryCtaLabel",slide.primaryCtaLabel||"Register Now")}${adminHeroField(i,"Secondary CTA label","secondaryCtaLabel",slide.secondaryCtaLabel||"Tournament Details")}${adminHeroSelect(i,"Image focal point","imagePosition",slide.imagePosition||"center",[["center","Center"],["top","Top"],["bottom","Bottom"],["left","Left"],["right","Right"]])}${adminHeroSelect(i,"Content position","contentPosition",slide.contentPosition||"center",[["center","Centered"],["left","Bottom left"]])}${adminHeroCheckbox(i,"Show secondary CTA","showSecondaryCta",!!slide.showSecondaryCta)}${adminHeroField(i,"Image URL","image",slide.image,"url")}${adminHeroField(i,"Image alt text","imageAlt",slide.imageAlt)}</div><div class="hero-upload-row"><label class="button button-ghost button-upload">Upload image<input type="file" accept="image/jpeg,image/png,image/webp" data-hero-upload="${i}"/></label><small>Standalone preview: max 500 KB per image. Production should use managed media storage.</small></div></article>`).join("")}</div>`;
  }
  function adminHeroField(index,label,fieldName,value,type="text"){
    return `<label class="field ${fieldName==="body"||fieldName==="headline"?"full":""}"><span>${esc(label)}</span>${fieldName==="body"||fieldName==="headline"?`<textarea data-hero-index="${index}" data-hero-field="${esc(fieldName)}">${esc(value||"")}</textarea>`:`<input type="${type}" data-hero-index="${index}" data-hero-field="${esc(fieldName)}" value="${esc(value||"")}"/>`}</label>`;
  }
  function adminHeroSelect(index,label,fieldName,value,options){
    return `<label class="field"><span>${esc(label)}</span><select data-hero-index="${index}" data-hero-field="${esc(fieldName)}">${options.map(([v,l])=>`<option value="${esc(v)}" ${v===value?"selected":""}>${esc(l)}</option>`).join("")}</select></label>`;
  }
  function adminHeroCheckbox(index,label,fieldName,value){
    return `<label class="admin-check-field"><input type="checkbox" data-hero-index="${index}" data-hero-field="${esc(fieldName)}" ${value?"checked":""}/><span><strong>${esc(label)}</strong><small>Adds a second compact pill beside the main Register button.</small></span></label>`;
  }
  function renderAdminFaq(){
    const items=adminDraft.faq||[];
    return `<div class="admin-panel-heading"><div><p class="eyebrow">Participant guidance</p><h2>Registration FAQ</h2><p>Edit the answers players see in the public FAQ. Keep each response clear, operationally accurate, and consistent with the final tournament rules.</p></div><button class="button button-ghost" id="addFaqButton" type="button">+ Add FAQ</button></div>
      <div class="admin-faq-list">${items.length?items.map((item,i)=>`<article class="admin-faq-card"><header><div><span class="admin-index">${String(i+1).padStart(2,"0")}</span><strong>${esc(item.q||"Untitled question")}</strong></div><button class="icon-button danger" type="button" data-remove-faq="${i}" aria-label="Remove FAQ item">×</button></header><div class="admin-form-grid"><label class="field full"><span>Question</span><input type="text" data-faq-index="${i}" data-faq-field="q" value="${esc(item.q||"")}"/></label><label class="field full"><span>Answer</span><textarea class="faq-answer-editor" data-faq-index="${i}" data-faq-field="a">${esc(item.a||"")}</textarea><small>Published exactly as participant guidance after Save & Publish.</small></label></div></article>`).join(""):`<div class="empty-state"><strong>No FAQ items yet.</strong>Add a question and answer to help players complete registration without contacting the organizer.</div>`}</div>`;
  }
  function renderAdminContact(){
    const c=adminDraft.contact||{};
    return `<div class="admin-panel-heading"><div><p class="eyebrow">Participant support</p><h2>Organizer contact</h2><p>These details appear in the registration portal and can later feed participant support workflows.</p></div></div><div class="admin-form-grid">${adminField("Contact name","contact.name",c.name)}${adminField("Email","contact.email",c.email,"email")}${adminField("Mobile","contact.mobile",c.mobile,"tel")}${adminField("Privacy policy URL","contact.privacyUrl",c.privacyUrl,"url")}</div>`;
  }
  function setDraftPath(path,value){
    const parts=path.split(".");let target=adminDraft;
    parts.slice(0,-1).forEach(k=>{target[k]??={};target=target[k]});
    target[parts.at(-1)]=value;
  }
  function bindAdminPanel(){
    $$("[data-admin-path]",$("#adminPanel")).forEach(input=>input.oninput=()=>{let v=input.value;if(input.type==="number")v=v===""?null:Number(v);setDraftPath(input.dataset.adminPath,v)});
    $$("[data-division-index]",$("#adminPanel")).forEach(input=>{const fn=()=>{const d=adminDraft.divisions[Number(input.dataset.divisionIndex)];const f=input.dataset.divisionField;let v=input.type==="checkbox"?input.checked:input.value;if(input.type==="number")v=v===""?null:Number(v);d[f]=v};input.onchange=fn;if(input.type!=="checkbox")input.oninput=fn});
    $$("[data-hero-index]",$("#adminPanel")).forEach(input=>{const fn=()=>{adminDraft.heroCarousel.slides[Number(input.dataset.heroIndex)][input.dataset.heroField]=input.type==="checkbox"?input.checked:input.value};input.oninput=fn;input.onchange=fn});
    $$("[data-faq-index]",$("#adminPanel")).forEach(input=>{const fn=()=>{const item=adminDraft.faq[Number(input.dataset.faqIndex)];item[input.dataset.faqField]=input.value};input.oninput=fn;input.onchange=fn});
    $$("[data-remove-division]",$("#adminPanel")).forEach(btn=>btn.onclick=()=>{adminDraft.divisions.splice(Number(btn.dataset.removeDivision),1);renderAdmin()});
    $$("[data-remove-hero]",$("#adminPanel")).forEach(btn=>btn.onclick=()=>{if(adminDraft.heroCarousel.slides.length<=1)return;adminDraft.heroCarousel.slides.splice(Number(btn.dataset.removeHero),1);renderAdmin()});
    $$("[data-remove-faq]",$("#adminPanel")).forEach(btn=>btn.onclick=()=>{adminDraft.faq.splice(Number(btn.dataset.removeFaq),1);renderAdmin()});
    $$("[data-hero-upload]",$("#adminPanel")).forEach(input=>input.onchange=()=>handleHeroUpload(input));
    const addDivision=$("#addDivisionButton");if(addDivision)addDivision.onclick=()=>{adminDraft.divisions.push({id:`division-${Date.now()}`,name:"New Division",classification:"",description:"",capacity:null,maxParticipants:null,slotsRemaining:null,fee:1800,eligibility:"",enabled:false,waitlistEnabled:true});renderAdmin()};
    const addSlide=$("#addHeroSlideButton");if(addSlide)addSlide.onclick=()=>{if(adminDraft.heroCarousel.slides.length>=5)return;adminDraft.heroCarousel.slides.push({eyebrow:"Tournament highlight",headline:"Add your headline",body:"Add supporting copy for this slide.",image:"",imageAlt:"",imagePosition:"center",contentPosition:"center",primaryCtaLabel:"Register Now",secondaryCtaLabel:"Tournament Details",showSecondaryCta:false});renderAdmin()};
    const addFaq=$("#addFaqButton");if(addFaq)addFaq.onclick=()=>{adminDraft.faq??=[];adminDraft.faq.push({q:"New question",a:"Add the organizer-approved answer here."});renderAdmin()};
  }
  function handleHeroUpload(input){
    const file=input.files?.[0];if(!file)return;
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)){showToast("Use a JPG, PNG, or WebP image");return}
    if(file.size>500*1024){showToast("Hero image must be 500 KB or smaller in this standalone preview");return}
    const reader=new FileReader();reader.onload=()=>{adminDraft.heroCarousel.slides[Number(input.dataset.heroUpload)].image=reader.result;renderAdmin();showToast("Hero image added to this draft")};reader.readAsDataURL(file);
  }
  function saveAdminChanges(){
    Object.keys(config).forEach(k=>delete config[k]);Object.assign(config,structuredClone(adminDraft));
    const persisted=persistAdminConfig();
    renderLanding();
    showToast(persisted?"Tournament details published":"Changes applied for this session");
    showView("landing");
  }
  function resetAdminChanges(){
    if(!confirm("Reset all locally saved admin changes and return to the packaged tournament configuration?"))return;
    localStorage.removeItem(ADMIN_CONFIG_KEY);location.reload();
  }

  function downloadICS(){
    if(placeholder(config.eventDate)){showToast('Event date must be configured first');return}
    const compact=config.eventDate.replace(/-/g,'');const content=`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:${compact}\nSUMMARY:${config.name}\nLOCATION:${config.venue}\nEND:VEVENT\nEND:VCALENDAR`;
    downloadBlob(content,'animo-pickleball-cup-2026.ics','text/calendar');
  }
  function downloadBlob(content,name,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}
  function printSummary(){window.print()}

  function handleAction(a){
    if(a==='home')showView('landing');
    if(a==='register'){showView('registration');renderStep()}
    if(a==='lookup')showView('lookup');
    if(a==='admin')return;
    if(a==='details'){showView('landing');setTimeout(()=>$("#detailsSection").scrollIntoView({behavior:'smooth'}),50)}
  }
  function bindGlobal(){
    $$('[data-action]').forEach(btn=>btn.addEventListener('click',()=>handleAction(btn.dataset.action)));
    $("#heroPrev").onclick=()=>setHeroSlide(heroIndex-1,true);$("#heroNext").onclick=()=>setHeroSlide(heroIndex+1,true);$("#heroPause").onclick=toggleHeroPause;
    $("#heroCarousel").addEventListener("touchstart",e=>{heroTouchStartX=e.changedTouches?.[0]?.clientX??null},{passive:true});
    $("#heroCarousel").addEventListener("touchend",e=>{if(heroTouchStartX==null)return;const end=e.changedTouches?.[0]?.clientX??heroTouchStartX;const delta=end-heroTouchStartX;heroTouchStartX=null;if(Math.abs(delta)>52)setHeroSlide(heroIndex+(delta<0?1:-1),true)},{passive:true});
    document.addEventListener("visibilitychange",()=>{if(document.hidden)clearInterval(heroTimer);else if($("#landingView").classList.contains("is-active"))restartHeroTimer()});
    $("#backButton").onclick=()=>{if(state.step>0){state.step--;renderStep()}};
    $("#nextButton").onclick=()=>{if(state.step===stepDefs.length-1){submitRegistration();return}if(validateStep()){state.step++;renderStep();window.scrollTo({top:0,behavior:'smooth'})}};
    $("#lookupForm").addEventListener('submit',lookup);
    $("#modalClose").onclick=()=>$("#modal").close();
    $("#copyReference").onclick=async()=>{try{await navigator.clipboard.writeText(state.reference);showToast('Registration reference copied')}catch{showToast('Copy unavailable')}};
    $("#viewRegistrationButton").onclick=()=>{showView('lookup');$("#lookupReference").value=state.reference;$("#lookupIdentity").value=state.player1.email||state.player1.mobile||'';lookup({preventDefault(){}})};
    $("#printSummaryButton").onclick=printSummary;$("#calendarButton").onclick=downloadICS;
    $$(".admin-tab").forEach(btn=>btn.onclick=()=>{adminTab=btn.dataset.adminTab;renderAdmin()});
    const adminBackButton=$("#adminBackButton"); if(adminBackButton) adminBackButton.onclick=()=>{adminDraft=null;showView('landing')};
    const adminSaveButton=$("#adminSaveButton"); if(adminSaveButton) adminSaveButton.onclick=saveAdminChanges;
    const adminResetButton=$("#adminResetButton"); if(adminResetButton) adminResetButton.onclick=resetAdminChanges;
    window.addEventListener('beforeunload',saveDraft);
  }

  loadAdminConfig();loadDraft();renderLanding();bindGlobal();
})();
