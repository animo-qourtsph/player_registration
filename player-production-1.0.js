(() => {
  "use strict";
  const config = window.TOURNAMENT_CONFIG;
  const SUPABASE_URL = "https://miavgvlffiloxsardwxl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_BhGGAi7yqRaKoMNaSkMm0A_G7lcgvUN";
  const REGISTRATION_API_URL = `${SUPABASE_URL}/functions/v1/registration-api`;
  const EXPECTED_API_CONTRACT = "2026.09.11.1";
  const REQUIRED_SCHEMA_VERSION = "2026.09.11.1";
  let backendCompatible = false;
  let backendCheckError = "";
  let portalStateLoadedAt = 0;
  let livePaymentProofFile = null;
  const STORAGE_KEY = `animo-registration-draft-${config.tournamentId}-production-1`;
  const DRAFT_MAX_AGE_MS = 24*60*60*1000;
  let heroIndex = 0;
  let heroTimer = null;
  let trackerRefreshTimer = null;
  let lastLookupCredentials = null;
  let livePaymentMethodsLoaded = false;
  let livePaymentMethodsLoading = false;
  let livePaymentMethodsError = "";
  let livePaymentMethodsLoadedAt = 0;
  let heroPaused = false;
  let heroTouchStartX = null;
  const stepDefs = [
    ["player","Player 1"],["partner","Partner"],["division","Division"],["payment","Payment"],["consent","Consent"],["review","Review"]
  ];
  const state = {
    step: 0,
    registrationType: "pair",
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
    emailDelivery: null,
    reference: "",
    status: "Draft",
    draftRestored:false,
    paymentNeedsReupload:false
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
  const validSupportingUrl = value => {
    try{
      const url=new URL(String(value||"").trim());
      return ["http:","https:"].includes(url.protocol);
    }catch{return false}
  };
  const enabledDivisions = () => config.divisions.filter(d=>d.enabled);
  const getDivision = id => config.divisions.find(d=>d.id===id);
  const adminDisplayValue = value => placeholder(value) ? "" : (value ?? "");
  const nl2br = value => esc(value).replace(/\n/g,"<br>");


  function showToast(message){const t=$("#toast");if(!t)return;t.textContent=message;t.classList.add("show");clearTimeout(showToast.t);showToast.t=setTimeout(()=>t.classList.remove("show"),2200)}
  function showView(name){
    if(!["lookup","confirmation"].includes(name)){
      if(trackerRefreshTimer)clearInterval(trackerRefreshTimer);
      trackerRefreshTimer=null;
    }

    const target=$("#"+name+"View");
    if(!target){
      console.warn(`View not found: ${name}`);
      return;
    }

    $$(".view").forEach(v=>v.classList.remove("is-active"));
    target.classList.add("is-active");
    document.body.dataset.activeView=name;

    const mobileSticky=$("#mobileSticky");
    if(mobileSticky)mobileSticky.style.display=name==="landing"?"":"none";

    if(name==="landing")restartHeroTimer();
    else if(heroTimer)clearInterval(heroTimer);

    window.scrollTo({top:0,behavior:"smooth"});
  }
  function updateRegistrationAvailabilityUi(){
    const open=config.registrationActive!==false;
    const message=config.registrationMessage||"Registration is currently closed.";

    $$('[data-action="register"]').forEach(button=>{
      button.disabled=!open;
      button.setAttribute("aria-disabled",open?"false":"true");
      button.classList.toggle("registration-closed",!open);
      if(!open)button.title=message;
      else button.removeAttribute("title");
    });

    const sticky=$("#mobileSticky");
    if(sticky){
      sticky.classList.toggle("registration-closed",!open);
      sticky.title=open?"":message;
    }

    $("#registrationAvailabilityNotice")?.remove();
    if(!open){
      const landing=$("#landingView");
      if(landing){
        const notice=document.createElement("div");
        notice.id="registrationAvailabilityNotice";
        notice.className="registration-availability-notice";
        notice.innerHTML=`<strong>Registration is currently closed.</strong><span>${esc(message)}</span>`;
        landing.prepend(notice);
      }
    }
  }

  function saveDraft(){
    if(state.submitted)return;
    const safe=structuredClone(state);
    safe.savedAt=Date.now();
    safe.payment.fileName=state.payment.fileName||"";
    safe.paymentNeedsReupload=!!state.payment.fileName&&!livePaymentProofFile;
    if(safe.verification1)safe.verification1.duprProofDataUrl="";
    if(safe.verification2)safe.verification2.duprProofDataUrl="";
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(safe))}
    catch(e){console.warn("Draft progress could not be persisted",e)}
    const el=$("#saveState");if(el)el.textContent="Saved for 24 hours";
  }

  function clearSavedDraft({silent=false}={}){
    try{localStorage.removeItem(STORAGE_KEY)}catch{}
    if(!silent)showToast("Saved draft cleared");
  }

  function loadDraft(){
    try{
      const raw=localStorage.getItem(STORAGE_KEY);
      if(!raw){state.registrationType="pair";return}
      const saved=JSON.parse(raw);
      const savedAt=Number(saved?.savedAt||0);
      if(!savedAt||Date.now()-savedAt>DRAFT_MAX_AGE_MS){
        clearSavedDraft({silent:true});
        state.registrationType="pair";
        return;
      }

      Object.assign(state,saved);
      state.registrationType="pair";
      state.additional={};
      state.verification1||={};
      state.verification2||={};
      state.partnerReference="";
      state.step=Math.max(0,Math.min(Number(state.step)||0,stepDefs.length-1));
      state.draftRestored=true;

      livePaymentProofFile=null;
      if(state.payment?.fileName){
        state.paymentNeedsReupload=true;
      }
      if(state.verification1?.duprProofName)state.verification1.duprProofDataUrl="";
      if(state.verification2?.duprProofName)state.verification2.duprProofDataUrl="";
    }catch(e){
      clearSavedDraft({silent:true});
      state.registrationType="pair";
      console.warn("Draft could not be restored",e)
    }
  }
  async function registrationApiJson(body){
    let response;
    try{
      response=await fetch(REGISTRATION_API_URL,{
        method:"POST",
        headers:{
          "apikey":SUPABASE_PUBLISHABLE_KEY,
          "Content-Type":"application/json"
        },
        body:JSON.stringify(body)
      });
    }catch(error){
      throw new Error("Could not reach the registration service. Check your internet connection and try again.");
    }

    let payload={};
    try{payload=await response.json()}catch{}
    if(!response.ok||payload?.ok===false){
      throw new Error(payload?.error||"The registration service returned an error.");
    }
    return payload;
  }



  function applyPortalState(response){
    const tournament=response?.tournament||{};
    const publicConfig=response?.publicConfig||{};

    Object.entries(publicConfig).forEach(([key,value])=>{
      if(value!==undefined&&value!==null)config[key]=structuredClone(value);
    });

    if(tournament.name)config.name=tournament.name;
    if(tournament.eventDate)config.eventDate=tournament.eventDate;
    if(tournament.venue)config.venue=tournament.venue;

    if(!config.publicStats)config.publicStats={};
    const approved=Number(tournament.approvedParticipants??tournament.confirmedParticipants);
    if(Number.isFinite(approved)){
      config.publicStats.approvedParticipantsOverride=Math.max(0,approved);
    }

    if(Array.isArray(response?.divisions)&&response.divisions.length){
      config.divisions=response.divisions.map(d=>({
        ...d,
        fee:Number.isFinite(Number(d.fee))?Number(d.fee):0,
        capacity:Number.isFinite(Number(d.capacity))?Number(d.capacity):null,
        maxParticipants:Number.isFinite(Number(d.maxParticipants))?Number(d.maxParticipants):null,
        slotsRemaining:Number.isFinite(Number(d.slotsRemaining))?Number(d.slotsRemaining):null,
        enabled:!!d.enabled
      }));
    }

    config.registrationActive=tournament.active!==false&&tournament.registrationOpen!==false;
    config.registrationMessage=tournament.registrationMessage||"";
    portalStateLoadedAt=Date.now();
    updateRegistrationAvailabilityUi();
  }

  async function checkBackendCompatibility(){
    try{
      const health=await registrationApiJson({action:"health"});
      const contract=String(health?.contractVersion||"");
      if(health?.schemaReady===false){
        backendCompatible=false;
        backendCheckError="Registration database schema is incomplete. Organizer action is required.";
        return false;
      }
      if(String(health?.schemaVersion||"")!==REQUIRED_SCHEMA_VERSION){
        backendCompatible=false;
        backendCheckError=`Registration database version mismatch. Expected ${REQUIRED_SCHEMA_VERSION}, received ${health?.schemaVersion||"missing"}.`;
        return false;
      }
      if(contract!==EXPECTED_API_CONTRACT){
        backendCompatible=false;
        backendCheckError=`Backend version mismatch. Expected ${EXPECTED_API_CONTRACT}, received ${contract||"unknown"}.`;
        return false;
      }
      backendCompatible=true;
      backendCheckError="";
      return true;
    }catch(error){
      backendCompatible=false;
      backendCheckError=error?.message||"Registration service is unavailable.";
      return false;
    }
  }

  async function loadLivePortalState(){
    const response=await registrationApiJson({action:"portal-state"});
    if(String(response?.contractVersion||"")!==EXPECTED_API_CONTRACT){
      backendCompatible=false;
      backendCheckError="Registration service version mismatch.";
      throw new Error(backendCheckError);
    }
    applyPortalState(response);
    backendCompatible=true;
    backendCheckError="";
    return response;
  }

  async function ensureProductionBackend({refreshPortal=false}={}){
    if(!backendCompatible){
      const compatible=await checkBackendCompatibility();
      if(!compatible){
        showToast(backendCheckError||"Registration service is unavailable.");
        return false;
      }
    }

    const stale=!portalStateLoadedAt||(Date.now()-portalStateLoadedAt)>300000;
    if(refreshPortal||stale){
      try{
        await loadLivePortalState();
      }catch(error){
        backendCompatible=false;
        backendCheckError=error?.message||"Tournament information could not be loaded.";
        showToast(backendCheckError);
        return false;
      }
    }

    if(config.registrationActive===false){
      showToast(config.registrationMessage||"Registration is currently closed.");
      return false;
    }

    return true;
  }

  async function loadLivePaymentMethods({rerender=false}={}){
    if(livePaymentMethodsLoading)return;
    livePaymentMethodsLoading=true;
    livePaymentMethodsError="";
    try{
      if(!backendCompatible){
        const compatible=await checkBackendCompatibility();
        if(!compatible)throw new Error(backendCheckError||"Registration service is unavailable.");
      }

      const response=await registrationApiJson({action:"payment-methods"});
      config.paymentMethods=Array.isArray(response?.methods)?response.methods:[];
      livePaymentMethodsLoaded=true;
      livePaymentMethodsLoadedAt=Date.now();
      if(state.payment.method&&!config.paymentMethods.some(m=>m.enabled&&m.id===state.payment.method)){
        state.payment.method="";
      }
    }catch(error){
      config.paymentMethods=[];
      livePaymentMethodsLoaded=false;
      livePaymentMethodsError=error?.message||"Payment methods could not be loaded.";
    }finally{
      livePaymentMethodsLoading=false;
      if(rerender&&state.step===3&&document.body.dataset.activeView==="registration")renderStep();
    }
  }

  async function registrationApiSubmit(formData){
    let response;
    try{
      response=await fetch(REGISTRATION_API_URL,{
        method:"POST",
        headers:{"apikey":SUPABASE_PUBLISHABLE_KEY},
        body:formData
      });
    }catch(error){
      throw new Error("Could not reach the registration service. Check your internet connection and try again.");
    }

    let payload={};
    try{payload=await response.json()}catch{}
    if(!response.ok||payload?.ok===false){
      throw new Error(payload?.error||"The registration could not be submitted.");
    }
    return payload;
  }

  function dataUrlToBlob(dataUrl){
    const [meta,data]=String(dataUrl||"").split(",");
    if(!meta||!data)return null;
    const mime=(meta.match(/data:([^;]+)/)||[])[1]||"application/octet-stream";
    const bytes=atob(data);
    const out=new Uint8Array(bytes.length);
    for(let i=0;i<bytes.length;i++)out[i]=bytes.charCodeAt(i);
    return new Blob([out],{type:mime});
  }

  function makeSubmissionPayload(){
    state.clientSubmissionId ||= (crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`);
    saveDraft();
    return {
      clientSubmissionId:state.clientSubmissionId,
      registrationType:"pair",
      player1:state.player1,
      player2:state.player2,
      verification1:{
        ...state.verification1,
        duprProofDataUrl:undefined
      },
      verification2:{
        ...state.verification2,
        duprProofDataUrl:undefined
      },
      payment:state.payment,
      consents:state.consents,
      waiverVersion:config.waiver?.version||""
    };
  }

  function getApprovedParticipantCount(){
    const override=config.publicStats?.approvedParticipantsOverride;
    if(override!==null&&override!==""&&Number.isFinite(Number(override))){
      return Math.max(0,Math.floor(Number(override)));
    }
    return 0;
  }

  function divisionCapacityState(d){
    const max=d.maxParticipants==null||d.maxParticipants===""?null:Math.max(0,Number(d.maxParticipants));
    const manualSlots=d.slotsRemaining==null||d.slotsRemaining===""?null:Number(d.slotsRemaining);
    const full=manualSlots!=null&&manualSlots<=0;
    return {max,locallyRemaining:null,manualSlots,full};
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
    if(!state.player2?.gender)return {categoryKey:null,label:"Category pending",pending:true,reason:"Player 2 information must be completed before category can be determined."};
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
    const partnerPending=false;
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
  function publicDate(value,fallback="To be announced"){
    const raw=String(value||"").trim();
    if(!raw||placeholder(raw))return fallback;
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){
      const d=new Date(`${raw}T00:00:00`);
      if(!Number.isNaN(d.getTime()))return d.toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});
    }
    return raw;
  }
  function shortVenue(){
    const raw=String(config.venue||"").trim();
    if(!raw||placeholder(raw))return "Venue to be announced";
    return raw.split(",")[0].trim()||raw;
  }
  function renderLanding(){
    renderHeroCarousel();

    const snapshot = [
      ["Approved players",getApprovedParticipantCount().toLocaleString("en-PH"),"fomo"],
      ["Event date",publicDate(config.eventDate)],
      ["Venue",shortVenue()],
      ["Registration fee",feeLabel()],
      ["Deadline",publicDate(config.registrationDeadline)]
    ];
    $("#snapshotGrid").innerHTML=snapshot.map(([k,v,kind])=>`<div class="snapshot-item ${kind==="fomo"?"snapshot-fomo":""}"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("");

    const poster=$("#homeEventPoster");
    if(poster){
      const posterSrc=String(config.brand?.eventPoster||"").trim();
      if(posterSrc&&!placeholder(posterSrc)){
        poster.src=posterSrc;
        poster.hidden=false;
      }else{
        poster.hidden=true;
        poster.parentElement?.classList.add("no-poster");
      }
    }

    const rules=[
      {icon:"D",title:"Have DUPR?",copy:"Enter your rating and upload a screenshot as proof."},
      {icon:"N",title:"No DUPR?",copy:"Request your level, add recent playing history, and optionally provide supporting evidence."},
      {icon:"=",title:"Same-tier partners",copy:"Both players must register under the same tournament level."}
    ];
    $("#homeRuleStack").innerHTML=rules.map(item=>`<article class="home-rule-item"><div class="home-rule-icon">${esc(item.icon)}</div><div><strong>${esc(item.title)}</strong><span>${esc(item.copy)}</span></div></article>`).join("");

    const thresholds=duprThresholds();
    const levels=[
      ["Beginner",`Below ${thresholds.lowIntermediateMin.toFixed(2)}`,"beginner"],
      ["Low Intermediate",`${thresholds.lowIntermediateMin.toFixed(2)} – ${(thresholds.highIntermediateMin-.01).toFixed(2)}`,"low"],
      ["High Intermediate",`${thresholds.highIntermediateMin.toFixed(2)} – ${(thresholds.advancedMin-.01).toFixed(2)}`,"high"],
      ["Advanced",`${thresholds.advancedMin.toFixed(2)}+`,"advanced"]
    ];
    $("#homeLevelGuide").innerHTML=levels.map(([name,range,key],i)=>`<article class="home-level-card level-${key}"><span class="home-level-index">${String(i+1).padStart(2,"0")}</span><strong>${esc(name)}</strong><small>DUPR</small><b>${esc(range)}</b></article>`).join("");

    const categories=[
      ["M","M","Men's Doubles"],
      ["F","F","Women's Doubles"],
      ["M","F","Mixed Doubles"]
    ];
    $("#homeCategoryMap").innerHTML=categories.map(([a,b,label])=>`<div class="home-category-row"><div class="home-gender-pair"><span>${a}</span><i>+</i><span>${b}</span></div><div class="home-category-arrow">→</div><strong>${esc(label)}</strong></div>`).join("");

    $("#faqList").innerHTML=config.faq.map((item,i)=>`<div class="faq-item"><button class="faq-button" type="button" aria-expanded="false"><span>${esc(item.q)}</span><span>+</span></button><div class="faq-answer">${esc(item.a)}</div></div>`).join("");
    $$(".faq-button").forEach(btn=>btn.addEventListener("click",()=>{const item=btn.parentElement;item.classList.toggle("open");btn.setAttribute("aria-expanded",item.classList.contains("open"));btn.lastElementChild.textContent=item.classList.contains("open")?"−":"+"}));

    $("#footerContact").textContent=[config.contact.email,config.contact.mobile].filter(v=>v&&!placeholder(v)).join(" · ") || "Organizer contact to be announced";
    const brandStrong=$(".brand-copy strong"),brandSmall=$(".brand-copy small"),footerTitle=$(".footer-shell strong"),footerOrganizer=$(".footer-shell>div:first-child p"),confirmationLead=$(".confirmation-lead");
    if(brandStrong)brandStrong.textContent=config.name.replace(/Pickleball Cup 2026/i,"").trim()||"Animo";
    if(brandSmall)brandSmall.textContent=config.name.match(/Pickleball Cup 2026/i)?.[0]||"Pickleball Cup 2026";
    if(footerTitle)footerTitle.textContent=config.name;
    if(footerOrganizer)footerOrganizer.textContent=`Organized by ${config.organizer}`;
    if(confirmationLead)confirmationLead.textContent=`Welcome to ${config.name}.`;
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
    $("#progressList").innerHTML=stepDefs.map(([,label],i)=>`<li class="${i===state.step?"active":i<state.step?"done":""}" ${i===state.step?'aria-current="step"':''}><span class="progress-step-number">${String(i+1).padStart(2,"0")}</span><span class="progress-step-label">${esc(label)}</span></li>`).join("");
  }
  function renderStep(){
    renderProgress();
    const container=$("#stepContainer");
    const renderers=[renderPlayer,renderPartner,renderDivision,renderPayment,renderConsent,renderReview];
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
  function shirtSizeField(prefix,data){
    const sizes=["","XS","S","M","L","XL","2XL","3XL"];
    return `<label class="field shirt-size-field" data-field="${esc(prefix)}.shirtSize">
      <span>Shirt Size *</span>
      <select name="${esc(prefix)}.shirtSize" required>
        ${sizes.map(size=>`<option value="${esc(size)}" ${size===String(data?.shirtSize||"")?"selected":""}>${esc(size||"Select shirt size")}</option>`).join("")}
      </select>
      <small>Select the size to be used for your tournament jersey.</small>
      <em class="field-error"></em>
    </label>`;
  }
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
  function jerseyPreviewName(value){
    const name=String(value||"").trim();
    return (name||"YOUR NAME").toUpperCase().slice(0,22);
  }

  function jerseyNameField(prefix,data,label){
    const preview=jerseyPreviewName(data?.jerseyName);
    return `<div class="jersey-personalization-field full" data-field="${esc(prefix)}.jerseyName">
      <div class="jersey-personalization-copy">
        <label class="field jersey-name-input">
          <span>Name to Print on Back of Jersey *</span>
          <input name="${esc(prefix)}.jerseyName" type="text" value="${esc(data?.jerseyName||"")}" autocomplete="off" maxlength="22" required />
          <small>Enter the exact spelling and capitalization you want printed on your jersey.</small>
          <em class="field-error"></em>
        </label>
        <div class="jersey-name-guidance">
          <span>PERSONALIZATION</span>
          <strong>This is production-facing information.</strong>
          <small>Check the spelling before continuing. The organizer will use the submitted name for the jersey-back print.</small>
        </div>
      </div>

      <div class="jersey-mini-preview">
        <div class="jersey-mini-head"><span>${esc(label)}</span><small>LIVE PREVIEW</small></div>
        <div class="jersey-mini-shirt" aria-label="${esc(label)} jersey-back preview">
          <span class="jersey-mini-collar"></span>
          <strong data-jersey-preview="${esc(prefix)}">${esc(preview)}</strong>
          <span class="jersey-mini-wordmark">ANIMO</span>
        </div>
        <small class="jersey-mini-caption">Preview of name placement only</small>
      </div>
    </div>`;
  }

  function updateJerseyPreviews(){
    $$("[data-jersey-preview]").forEach(el=>{
      const prefix=el.dataset.jerseyPreview;
      el.textContent=jerseyPreviewName(state[prefix]?.jerseyName);
    });
  }

  function verificationFields(prefix,data,label){
    const hasDupr=data.hasDupr||"";
    return `<div class="verification-block"><div class="subsection-heading"><div><h3>Level verification & jersey details</h3><p>Confirm your jersey details, then tell us whether you have a DUPR rating. If you do not, you may request a playing level and the organizer will validate it using the information you provide.</p></div><span class="status-pill">${esc(label)}</span></div><div class="form-grid">
      ${field(prefix,"clubAffiliation","Club Affiliation",data.clubAffiliation,"text","organization",true,'Enter your current pickleball club. If you are not affiliated with a club, enter "No Club".')}
      ${jerseyNameField(prefix,data,label)}
      ${shirtSizeField(prefix,data)}
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
    return `${stepHeading("01 · Player 1 information","Tell us about Player 1.","Complete your tournament profile and level-verification details in one step.")}
      ${playerFields("player1",state.player1,"PLAYER 1")}
      <div class="subsection">${verificationFields("verification1",state.verification1,"PLAYER 1")}</div>`;
  }

  function renderPartner(){
    return `${stepHeading("02 · Partner information","Add Player 2.","Complete your partner's tournament profile and level-verification details. Both players form one team registration.")}
      ${playerFields("player2",state.player2,"PLAYER 2")}
      <div class="subsection">${verificationFields("verification2",state.verification2,"PLAYER 2")}</div>`;
  }

  function eligibilityOutputMarkup(data,label){
    const result=verificationEligibility(data);
    if(data?.hasDupr==="No"){
      if(data?.manualLevelApproved&&result.levelKey)return `<div class="eligibility-result success"><span>Organizer-validated level</span><strong>${esc(result.label)}</strong><p>${esc(label)}'s playing level has been validated by the tournament organizer.</p></div>`;
      if(result.levelKey)return `<div class="eligibility-result manual"><span>Requested level</span><strong>${esc(result.label)}</strong><p>Subject to organizer validation using the playing background and any optional supporting evidence provided.</p></div>`;
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
      return `${stepHeading("03 · Division","Partner levels do not match.","Both players must be classified in the same tournament level before registration can continue.")}
        <div class="team-eligibility-card manual"><span>Registration blocked</span><strong>Partner Level Mismatch</strong><p>${esc(decision.reason)}</p></div>
        ${placementSummaryMarkup(decision)}
        <div class="config-alert"><strong>What to do:</strong><br>Return to the Player or Partner step and correct the DUPR information if it was entered incorrectly. The system will not automatically move a mismatched pair into the higher division.</div>`;
    }
    if(decision.classificationPending||decision.partnerPending){
      return `${stepHeading("03 · Division","Division pending organizer review.","Your final tournament level must be resolved before a division can be assigned.")}
        <div class="team-eligibility-card manual"><span>Level review required</span><strong>${esc(decision.label)}</strong><p>${esc(decision.reason)}</p></div>
        ${placementSummaryMarkup(decision)}
        <div class="config-alert"><strong>Complete the missing level information first.</strong><br>Once both players have a usable level and the category can be determined, the system will assign the division automatically.</div>`;
    }
    if(decision.categoryPending){
      return `${stepHeading("03 · Division","Category verification required.","Your level is known, but the doubles category cannot be determined automatically from the player information provided.")}
        <div class="team-eligibility-card manual"><span>Category pending</span><strong>${esc(decision.categoryLabel||"Organizer review required")}</strong><p>${esc(decision.reason)}</p></div>
        ${placementSummaryMarkup(decision)}
        <div class="config-alert"><strong>No category selection is shown to the player.</strong><br>The tournament committee will assign the correct category before approval and payment.</div>`;
    }
    const exact=divs[0];
    const cap=exact?divisionCapacityState(exact):null;
    const assigned=exact&&!cap?.full;
    return `${stepHeading("03 · Division","Your division is determined automatically.","Both player level and gender combination are used to assign the correct tournament division.")}
      <div class="team-eligibility-card ${decision.manualReview?"manual":"success"}"><span>${decision.manualReview?"Provisional same-level pair":"Verified same-level pair"}</span><strong>${esc(duprLevelLabel(decision.levelKey))} · ${esc(decision.categoryLabel)}</strong><p>${decision.manualReview?"One or more player levels are still subject to organizer validation. ":""}Both partners are currently in the same level.</p></div>
      ${placementSummaryMarkup(decision)}
      ${!exact?`<div class="config-alert"><strong>No matching division is configured.</strong><br>There is no enabled ${esc(duprLevelLabel(decision.levelKey))} ${esc(decision.categoryLabel)} division. Please contact the organizer.</div>`:
      cap.full?`<div class="config-alert"><strong>${esc(exact.name)} is full.</strong><br>This pair cannot proceed to payment while the division has no available slots.</div>`:
      `<div class="subsection"><div class="subsection-heading"><div><h3>Assigned division</h3><p>No manual division selection is needed.</p></div><button type="button" class="inline-link" data-modal="eligibility">View level rules</button></div><div class="choice-grid"><article class="division-card selected static-card"><strong>${esc(exact.name)}</strong><p>${esc(exact.description||exact.classification||"")}</p><div class="card-meta"><span class="meta-chip">Automatically assigned</span><span class="meta-chip">${money(exact.fee)} / player</span></div></article></div></div>`}`;
  }
  function currentParticipantCount(){return 2}
  function calcFees(){
    let total=0, unknown=false;const lines=[];const participants=currentParticipantCount();
    state.divisions.forEach(id=>{const d=getDivision(id);if(!d)return;const unit=d.fee;if(unit==null){unknown=true;lines.push([d.name,null]);return}const lineTotal=Number(unit)*participants;total+=lineTotal;lines.push([`${d.name} · ${participants} player${participants===1?"":"s"} × ${money(unit)}`,lineTotal])});
    return {total:unknown?null:total,lines};
  }
  function renderPayment(){
    const decision=teamEligibilityDecision();
    const paymentOnHold=decision.classificationPending||decision.partnerPending||decision.categoryPending||decision.levelMismatch||!state.divisions.length;

    if(paymentOnHold){
      return `${stepHeading("04 · Payment","Payment is on hold.","We do not collect payment until the team level and final division are resolved.")}
        <div class="team-eligibility-card manual"><span>Payment not required yet</span><strong>Level / division verification pending</strong><p>Submit this registration for organizer review. Once the team is classified into the same level and a division is assigned, payment can be completed under the organizer-approved process.</p></div>`;
    }

    const paymentMethodsStale=!livePaymentMethodsLoadedAt||(Date.now()-livePaymentMethodsLoadedAt)>1800000;
    if(!livePaymentMethodsLoaded||paymentMethodsStale){
      if(!livePaymentMethodsLoading)setTimeout(()=>loadLivePaymentMethods({rerender:true}),0);
      return `${stepHeading("04 · Payment","Review the fee before paying.","Payment methods are managed by the tournament organizer.")}
        <div class="payment-live-loading">
          <strong>${livePaymentMethodsError?"Payment methods unavailable":"Loading payment methods…"}</strong>
          <p>${esc(livePaymentMethodsError||"Getting the latest organizer-approved account and QR information.")}</p>
          ${livePaymentMethodsError?`<button type="button" class="button button-ghost" data-refresh-payment-methods>Try Again</button>`:""}
        </div>`;
    }

    const methods=(config.paymentMethods||[]).filter(m=>m.enabled);
    const fees=calcFees();

    return `${stepHeading("04 · Payment","Review the fee before paying.","Only payment methods currently enabled by the organizer are shown.")}
      <div class="fee-box">${fees.lines.length?fees.lines.map(([n,f])=>`<div class="fee-line"><span>${esc(n)}</span><strong>${money(f)}</strong></div>`).join(""):`<div class="fee-line"><span>Registration fee</span><strong>[REGISTRATION_FEE]</strong></div>`}<div class="fee-total"><span>Total</span><strong>${money(fees.total)}</strong></div></div>

      <div class="subsection">
        <div class="subsection-heading"><div><h3>Payment method</h3><p>Choose one organizer-approved payment destination.</p></div></div>
        ${!methods.length
          ? `<div class="config-alert"><strong>No payment method is currently available.</strong><br>Please contact the organizer before making a payment.</div>`
          : `<div class="choice-grid">${methods.map(m=>`<button type="button" class="choice-card ${state.payment.method===m.id?"selected":""}" data-payment="${esc(m.id)}"><strong>${esc(m.label)}</strong><p>${esc(m.accountName||"")}${m.accountName&&m.accountNumber?" · ":""}${esc(m.accountNumber||"")}</p></button>`).join("")}</div>`}
      </div>
      ${state.payment.method?paymentDetails(methods.find(m=>m.id===state.payment.method)):""}`;
  }

  function paymentDetails(m){
    if(!m)return"";

    return `<div class="subsection payment-method-details">
      <div class="subsection-heading">
        <div><h3>${esc(m.label)} payment details</h3><p>${esc(m.instructions||"Use the account details below and upload your proof of payment.")}</p></div>
        ${m.accountNumber?`<button type="button" class="inline-link" data-copy="${esc(m.accountNumber)}">Copy Account Number</button>`:""}
      </div>

      <div class="live-payment-destination">
        ${m.qrUrl?`<button class="live-payment-qr" type="button" data-open-payment-qr="${esc(m.qrUrl)}"><img src="${esc(m.qrUrl)}" alt="${esc(m.label)} QR code"/><span>Tap QR to open</span></button>`:""}
        <div class="live-payment-account">
          <span>Pay to</span>
          <strong>${esc(m.accountName||m.label)}</strong>
          ${m.accountNumber?`<b>${esc(m.accountNumber)}</b>`:""}
        </div>
      </div>

      <div class="form-grid">
        ${field("payment","reference","Payment Reference Number",state.payment.reference,"text","off",true)}
        ${field("payment","senderName","Account / Sender Name",state.payment.senderName,"text","name",true)}
        ${field("payment","amountPaid","Amount Paid",state.payment.amountPaid,"number","off",true)}
        ${field("payment","paymentDate","Payment Date",state.payment.paymentDate,"date","off",true)}
      </div>

      <div class="file-drop" style="margin-top:18px">
        <label for="paymentFile">Upload Proof of Payment</label>
        <p>Required · JPG, PNG, or PDF, up to 8 MB. You cannot submit without attaching proof of payment.</p>
        <input id="paymentFile" type="file" accept="image/jpeg,image/png,application/pdf"/>
        ${state.payment.fileName&&livePaymentProofFile?`<div class="file-confirm">✓ ${esc(state.payment.fileName)}</div>`:""}
        ${state.paymentNeedsReupload?`<div class="file-reupload-warning">Previously selected payment files are not stored in your browser draft. Please attach the proof again.</div>`:""}
      </div>
      <p class="submit-note">Your payment proof is submitted for organizer verification. Your registration remains <strong>Under Review</strong> until approved.</p>
    </div>`;
  }

  function renderConsent(){return `${stepHeading("05 · Waiver & consent","Review the acknowledgements.","Consent is never pre-selected. Expand the organizer-approved full waiver before submission when required.")}<div class="consent-list">${consent("rules","Tournament rules & eligibility","I acknowledge the organizer-approved tournament rules and eligibility requirements.",true)}${consent("risk","Assumption of risk","I acknowledge the organizer-approved assumption of risk and medical responsibility terms.",true)}${consent("privacy","Data privacy","I consent to the tournament processing the information required for official event operations.",true)}${consent("accuracy","Information accuracy & level verification","I confirm that my DUPR status, rating, club affiliation, and playing history are accurate. I understand that inaccurate or misleading information may result in reclassification, decline, or disqualification.",true)}${consent("media","Photography / video","I acknowledge the organizer-approved photography/video policy where applicable.",false)}</div><button type="button" class="button button-ghost" style="margin-top:18px" data-modal="waiver">Read Full Waiver</button>`}
  function consent(key,title,copy,required){
    return `<label class="consent-option ${state.consents[key]?"is-checked":""}">
      <input type="checkbox" name="consent.${key}" ${state.consents[key]?"checked":""} ${required?"required":""}/>
      <span class="consent-check" aria-hidden="true"></span>
      <span class="consent-copy">
        <span class="consent-title-row">
          <strong>${esc(title)}</strong>
          <em class="consent-requirement ${required?"required":"optional"}">${required?"Required":"Optional"}</em>
        </span>
        <small>${esc(copy)}</small>
      </span>
    </label>`;
  }
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
        <div><dt>Shirt size</dt><dd>${esc(verification?.shirtSize||"—")}</dd></div>
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
        <button class="review-edit" type="button" data-edit-step="2">Review division</button>
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
        <button class="review-edit" type="button" data-edit-step="3">Edit</button>
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
        <button class="review-edit" type="button" data-edit-step="4">Edit</button>
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
    const playerCards=`${reviewPlayerCard(state.player1,state.verification1,"PLAYER 1",0)}${reviewPlayerCard(state.player2,state.verification2,"PLAYER 2",1)}`;

    return `${stepHeading("06 · Final review","Confirm your tournament entry.","Check the important details below. Use Edit if anything is incorrect before you submit.")}
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
        <div class="review-overview-item"><span>Registration</span><strong>Team / Partner</strong></div>
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
  function typeLabel(id){return id==="pair"?"Team / Partner Registration":"Team / Partner Registration"}
  function paymentLabel(id){return config.paymentMethods.find(t=>t.id===id)?.label||""}
  function requiredConsentsComplete(){return ["rules","risk","privacy","accuracy"].every(k=>state.consents[k])}

  function bindStepEvents(){
    $$('[data-payment]').forEach(btn=>btn.onclick=()=>{state.payment.method=btn.dataset.payment;renderStep()});
    const refreshPaymentMethods=$("[data-refresh-payment-methods]");
    if(refreshPaymentMethods)refreshPaymentMethods.onclick=()=>loadLivePaymentMethods({rerender:true});
    $$("[data-open-payment-qr]").forEach(btn=>btn.onclick=()=>{const url=btn.dataset.openPaymentQr;if(url)window.open(url,"_blank","noopener")});
    $$('[data-copy]').forEach(btn=>btn.onclick=async()=>{try{await navigator.clipboard.writeText(btn.dataset.copy);showToast("Account number copied")}catch{showToast("Copy unavailable")}});
    $$('[data-modal]').forEach(btn=>btn.onclick=()=>openModal(btn.dataset.modal));
    $$('[data-edit-step]').forEach(btn=>btn.onclick=()=>{state.step=Number(btn.dataset.editStep);renderStep()});
    $$('input[name], select[name], textarea[name]').forEach(input=>{
      input.addEventListener('input',()=>{
        captureInput(input);
        if(input.name.endsWith('.duprRating')||input.name.endsWith('.requestedLevel')||input.name.endsWith('.gender')){state.divisions=[];updateEligibilityOutputs();}
        if(input.name.endsWith('.jerseyName'))updateJerseyPreviews();
      });
      input.addEventListener('change',()=>{
        captureInput(input);
        if(input.name.startsWith('consent.')){
          input.closest('.consent-option')?.classList.toggle('is-checked',input.checked);
        }
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
  async function compressUploadImageFile(file,{maxSide=1800,quality=.78}={}){
    if(!["image/jpeg","image/png","image/webp"].includes(file.type))return file;
    return await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error("Unable to read image"));
      reader.onload=()=>{
        const img=new Image();
        img.onerror=()=>reject(new Error("Invalid image"));
        img.onload=()=>{
          const scale=Math.min(1,maxSide/Math.max(img.width,img.height));
          if(scale===1&&file.type==="image/jpeg"&&file.size<=650*1024){
            resolve(file);
            return;
          }
          const canvas=document.createElement("canvas");
          canvas.width=Math.max(1,Math.round(img.width*scale));
          canvas.height=Math.max(1,Math.round(img.height*scale));
          const ctx=canvas.getContext("2d");
          if(!ctx){reject(new Error("Image processor unavailable"));return}
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          canvas.toBlob(blob=>{
            if(!blob){reject(new Error("Image compression failed"));return}
            const stem=(file.name||"payment-proof").replace(/\.[^.]+$/,"");
            resolve(new File([blob],`${stem}.jpg`,{type:"image/jpeg",lastModified:Date.now()}));
          },"image/jpeg",quality);
        };
        img.src=reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleFile(input){
    const original=input.files?.[0]; if(!original)return;
    const allowed=['image/jpeg','image/png','application/pdf'];
    if(!allowed.includes(original.type)){input.value='';showToast('Please upload a JPG, PNG, or PDF');return}
    if(original.size>8*1024*1024){input.value='';showToast('File is too large. Maximum 8 MB');return}

    try{
      input.disabled=true;
      const file=original.type==="application/pdf"
        ? original
        : await compressUploadImageFile(original,{maxSide:1800,quality:.78});
      livePaymentProofFile=file;
      state.payment.fileName=file.name;
      state.payment.fileType=file.type;
      state.paymentNeedsReupload=false;
      saveDraft();
      renderStep();
      if(file.size<original.size){
        showToast(`Payment proof optimized from ${(original.size/1024/1024).toFixed(1)} MB to ${(file.size/1024/1024).toFixed(1)} MB`);
      }else{
        showToast("Payment proof attached");
      }
    }catch(error){
      console.warn(error);
      input.disabled=false;
      showToast("We could not process that payment proof");
    }
  }

  function validateStep(){
    clearErrors();let errors=[];
    if(state.step===0){
      errors.push(...validatePlayer('player1',state.player1));
      errors.push(...validateVerification('verification1',state.verification1,'Player 1'));
    }
    if(state.step===1){
      errors.push(...validatePlayer('player2',state.player2));
      errors.push(...validateVerification('verification2',state.verification2,'Player 2'));
    }
    if(state.step===2){
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
    if(state.step===3){
      const decision=teamEligibilityDecision();
      const paymentBlocked=decision.classificationPending||decision.partnerPending||decision.categoryPending||decision.levelMismatch||!state.divisions.length;
      if(paymentBlocked){
        errors.push('Complete level and division eligibility before payment.');
      }else{
        const enabledMethods=(config.paymentMethods||[]).filter(method=>method.enabled);
        if(!livePaymentMethodsLoaded)errors.push('Payment methods are still loading. Try again in a moment.');
        else if(!enabledMethods.length)errors.push('No payment method is currently available. Contact the organizer.');
        else if(!state.payment.method||!enabledMethods.some(method=>method.id===state.payment.method))errors.push('Select a payment method.');
        for(const [key,label] of [["reference","Payment reference number"],["senderName","Sender name"],["amountPaid","Amount paid"],["paymentDate","Payment date"]]){
          if(!String(state.payment?.[key]??"").trim()){
            markInvalid(`payment.${key}`,`${label} is required.`);
            errors.push(`${label} is required.`);
          }
        }
        if(!(Number(state.payment.amountPaid)>0))errors.push('Enter a valid amount paid.');
        if(!state.payment.fileName||!livePaymentProofFile)errors.push('Attach proof of payment before continuing.');
      }
    }
    if(state.step===4&&!requiredConsentsComplete())errors.push('Complete all required acknowledgements before continuing.');
    if(errors.length){showToast(errors[0]);focusFirstError();return false}
    return true;
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
    for(const [key,label] of [['clubAffiliation','Club Affiliation'],['jerseyName','Jersey back name'],['shirtSize','Shirt size'],['hasDupr','DUPR status']]){
      if(!String(data?.[key]||'').trim()){markInvalid(`${prefix}.${key}`,`${label} is required.`);e.push(`${playerLabel}: ${label} is required.`)}
    }
    if(data?.shirtSize&&!["XS","S","M","L","XL","2XL","3XL"].includes(data.shirtSize)){
      markInvalid(`${prefix}.shirtSize`,'Select a valid shirt size.');
      e.push(`${playerLabel}: select a valid shirt size.`);
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
      if(String(data.verificationReference||'').trim()&&!validSupportingUrl(data.verificationReference)){
        markInvalid(`${prefix}.verificationReference`,"Use a valid https:// link if you provide supporting evidence.");
        e.push(`${playerLabel}: supporting verification link must be a valid URL.`);
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

  async function submitRegistration(){
    if(state.submitted)return;

    if(!await ensureProductionBackend({refreshPortal:true}))return;
    sanitizeDivisionSelection();

    if(!validateAll())return;
    if(!state.payment.method){state.step=3;renderStep();showToast('Select a payment method before submitting.');return}
    if(!state.payment.fileName||!livePaymentProofFile){state.step=3;renderStep();showToast('Proof of payment is required before submitting.');return}

    const btn=$("#nextButton");
    btn.disabled=true;
    btn.textContent="Submitting securely…";

    try{
      const formData=new FormData();
      formData.append("action","submit");
      formData.append("payload",JSON.stringify(makeSubmissionPayload()));

      if(state.verification1?.hasDupr==="Yes"){
        const blob=dataUrlToBlob(state.verification1.duprProofDataUrl);
        if(!blob)throw new Error("Player 1 DUPR screenshot must be re-uploaded before submission.");
        formData.append("dupr_player_1",blob,state.verification1.duprProofName||"player-1-dupr.jpg");
      }

      if(state.verification2?.hasDupr==="Yes"){
        const blob=dataUrlToBlob(state.verification2.duprProofDataUrl);
        if(!blob)throw new Error("Player 2 DUPR screenshot must be re-uploaded before submission.");
        formData.append("dupr_player_2",blob,state.verification2.duprProofName||"player-2-dupr.jpg");
      }

      if(!livePaymentProofFile)throw new Error("Payment proof must be re-uploaded before submission.");
      formData.append("payment_proof",livePaymentProofFile,state.payment.fileName);

      const response=await registrationApiSubmit(formData);
      const record=response.record;
      if(!record?.reference)throw new Error("The registration service did not return a registration reference.");

      state.reference=record.reference;
      state.status=publicWorkflowStatus(record.status||"Under Review");
      state.submitted=true;
      state.registrationType="pair";


      state.emailDelivery=response.email||null;

      localStorage.removeItem(STORAGE_KEY);
      livePaymentProofFile=null;
      lastLookupCredentials={
        reference:state.reference,
        identity:state.player1.email||state.player1.mobile||""
      };
      renderConfirmation();
      showView("confirmation");
      startTrackerRefresh();
    }catch(error){
      console.warn(error);
      showToast(error?.message||"Registration could not be submitted.");
    }finally{
      btn.disabled=false;
      btn.textContent=state.step===stepDefs.length-1?"Submit for Review":"Continue";
    }
  }

  function validateAll(){
    const original=state.step;
    for(const s of [0,1,2,3,4]){
      state.step=s;renderStep();
      if(!validateStep()){showToast(`Please complete ${stepDefs[s][1]} before submitting.`);return false}
    }
    state.step=original;renderStep();return true;
  }

  function openDuplicateModal(record){
    const modal=$("#modal");$("#modalBody").innerHTML=`<p class="eyebrow">Possible duplicate</p><h2>We may already have a registration matching these details.</h2><p>To protect participant records, this submission has not been duplicated.</p><div class="choice-grid" style="margin-top:20px"><button class="button button-primary" id="dupView">Check Existing Registration</button><button class="button button-ghost" id="dupDifferent">Use Different Information</button></div>`;modal.showModal();$("#dupView").onclick=()=>{modal.close();showView('lookup');$("#lookupReference").value=record.reference||'';$("#lookupIdentity").value=state.player1.email||state.player1.mobile||''};$("#dupDifferent").onclick=()=>{modal.close();state.step=0;renderStep()};
  }
  function renderConfirmation(){
    $("#confirmationReference").textContent=state.reference;
    $("#confirmationStatus").textContent=state.status;
    const message=$("#confirmationEmailMessage");
    if(message){
      const delivery=state.emailDelivery;
      if(delivery?.sent>=2){
        message.textContent="Registration registration receipt emails were sent to Player 1 and Player 2. Keep your registration reference for future status checks.";
      }else if(delivery?.sent===1){
        message.textContent="Your registration was saved and one registration receipt email was sent. The second email could not be delivered.";
      }else if(delivery?.configured===false){
        message.textContent="Your registration is safely stored in the tournament database. Email delivery is not configured yet, so no confirmation email was sent.";
      }else if(delivery){
        message.textContent="Your registration is safely stored, but the registration receipt emails could not be delivered. Your registration reference is still valid.";
      }else{
        message.textContent="Your registration is safely stored. Email delivery status is currently unavailable.";
      }
    }
  }

  function openModal(kind){
    const modal=$("#modal");let html='';
    if(kind==='eligibility'){
      const t=duprThresholds();
      html=`<p class="eyebrow">Level eligibility rules</p><h2>How division placement works</h2><p>If you have DUPR, enter your current rating and upload a screenshot showing your name and rating. The system calculates a provisional level and the tournament committee verifies the proof. If you do not have DUPR, choose the level you are requesting and provide recent playing history and, when available, an optional supporting club/community link. The organizer validates that request before approval.</p><div class="dupr-threshold-list"><div><strong>Beginner</strong><span>Below ${t.lowIntermediateMin.toFixed(2)}</span></div><div><strong>Low Intermediate</strong><span>${t.lowIntermediateMin.toFixed(2)} – ${(t.highIntermediateMin-0.01).toFixed(2)}</span></div><div><strong>High Intermediate</strong><span>${t.highIntermediateMin.toFixed(2)} – ${(t.advancedMin-0.01).toFixed(2)}</span></div><div><strong>Advanced</strong><span>${t.advancedMin.toFixed(2)}+</span></div></div><div class="config-alert"><strong>Pair rule:</strong> Both partners must be in the same tournament level. The system does not automatically move a mismatched pair upward. Gender is limited to Male or Female. Category is assigned automatically: Male/Male = Men's, Female/Female = Women's, Male/Female = Mixed.</div><div class="config-alert" style="margin-top:12px"><strong>No-DUPR validation:</strong> A requested level is provisional. The organizer may approve, reclassify, or decline the registration based on the information provided.</div>`;
    }
    if(kind==='waiver'){
      const fullText=String(config.waiver?.fullText||"").trim();
      const version=String(config.waiver?.version||"").trim();
      html=(!fullText||placeholder(fullText)||!version||placeholder(version))
        ? `<p class="eyebrow">Waiver & consent</p><h2>Waiver temporarily unavailable</h2><p>The organizer has not published the final tournament waiver yet. Registration will remain closed until the current waiver is available.</p>`
        : `<p class="eyebrow">Waiver & consent</p><h2>Full tournament waiver</h2><div class="waiver-full-text">${nl2br(fullText)}</div><p class="submit-note">Waiver version: ${esc(version)}</p>`;
    }
    $("#modalBody").innerHTML=html;modal.showModal();
  }
  function lookupPlayerName(player){
    return [player?.firstName,player?.middleName,player?.lastName].filter(Boolean).join(" ").trim()||"Pending player";
  }

  function lookupDivisionName(record){
    const names=(record?.divisions||[]).map(id=>getDivision(id)?.name||id).filter(Boolean);
    if(names.length)return names.join(", ");
    if(record?.status==="Awaiting Partner")return "Division pending review";
    return "Division pending";
  }

  function lookupLevelLabel(record){
    const snapshot=record?.eligibilitySnapshot||{};
    if(snapshot.levelKey)return duprLevelLabel(snapshot.levelKey);
    const v1=verificationEligibility(record?.verification1||{});
    const v2=verificationEligibility(record?.verification2||{});
    if(v1.levelKey&&record?.registrationType!=="pair")return duprLevelLabel(v1.levelKey);
    if(v1.levelKey&&v2.levelKey&&v1.levelKey===v2.levelKey)return duprLevelLabel(v1.levelKey);
    if(v1.levelKey&&v2.levelKey&&v1.levelKey!==v2.levelKey)return "Level mismatch";
    return "Pending";
  }

  function lookupCategoryLabel(record){
    const snapshot=record?.eligibilitySnapshot||{};
    if(snapshot.categoryLabel)return snapshot.categoryLabel;
    const g1=record?.player1?.gender,g2=record?.player2?.gender;
    if(g1==="Male"&&g2==="Male")return "Men's Doubles";
    if(g1==="Female"&&g2==="Female")return "Women's Doubles";
    if((g1==="Male"&&g2==="Female")||(g1==="Female"&&g2==="Male"))return "Mixed Doubles";
    return "Pending";
  }

  function publicWorkflowStatus(status){
    const value=String(status||"Under Review");
    if(value==="Confirmed")return "Approved";
    if(value==="Rejected")return "Declined";
    if(["Submitted","Payment Submitted","Awaiting Partner","Pending Level Validation","Pending Level Verification","Pending"].includes(value))return "Under Review";
    return value;
  }

  function lookupVerificationLabel(record){
    const status=publicWorkflowStatus(record?.status);
    if(status==="Approved")return "Verified";
    if(["Declined","Withdrawn","Cancelled"].includes(status))return "Review closed";

    const snap=record?.eligibilitySnapshot||{};
    if(snap.levelMismatch)return "Partner level mismatch";
    if(snap.classificationPending)return "Level information pending";
    if(snap.manualReview)return "Organizer validation pending";

    const v1=verificationEligibility(record?.verification1||{});
    const v2=record?.registrationType==="pair"?verificationEligibility(record?.verification2||{}):null;
    if(v1.manual||(v2&&v2.manual))return "Organizer validation pending";
    if(v1.verified&&(!v2||v2.verified))return "Player levels verified";
    return "Under review";
  }

  function lookupPaymentLabel(record){
    const status=publicWorkflowStatus(record?.status);
    if(record?.paymentHeld)return "Payment review pending";
    if(status==="Approved")return "Verified";
    if(record?.payment?.fileName)return "Proof submitted";
    return "No payment proof on file";
  }

  function lookupStatusModel(record){
    const rawStatus=String(record?.status||"Under Review");
    const status=publicWorkflowStatus(rawStatus);
    const eventDate=publicDate(config.eventDate);
    const venue=shortVenue();

    const base={
      raw:status,
      tone:"review",
      visibleStatus:"Under Review",
      eyebrow:"Registration review",
      headline:"Your registration is under review.",
      message:"The tournament team is reviewing player eligibility, division placement, and payment before making a registration decision.",
      nextTitle:"No action needed unless we contact you",
      nextBody:"Keep your registration reference. This page will update when your registration is approved or declined.",
      progress:2
    };

    if(status==="Approved"){
      return {...base,
        tone:"approved",
        visibleStatus:"Approved",
        eyebrow:"Official registration",
        headline:"Your registration is approved.",
        message:`Your team is officially registered for Animo Pickleball Cup 2026 on ${eventDate} at ${venue}.`,
        nextTitle:"You’re officially in",
        nextBody:"Keep your registration reference and watch for schedule, player-guide, and tournament-day announcements.",
        progress:3
      };
    }

    if(status==="Declined"){
      return {...base,
        tone:"rejected",
        visibleStatus:"Declined",
        eyebrow:"Registration decision",
        headline:"Your registration was declined.",
        message:"The tournament organizer did not accept this registration.",
        nextTitle:"Need clarification?",
        nextBody:"Contact the tournament organizer if you need clarification or believe the registration should be reviewed again.",
        progress:2,
        stopped:true
      };
    }

    if(status==="Withdrawn"){
      return {...base,
        tone:"cancelled",
        visibleStatus:"Withdrawn",
        eyebrow:"Roster update",
        headline:"Your approved registration was withdrawn.",
        message:"This team was previously approved but is no longer part of the active tournament roster.",
        nextTitle:"Need clarification?",
        nextBody:"Contact the tournament organizer if you need the reason for the withdrawal or want to ask about reopening the registration.",
        progress:3,
        stopped:true
      };
    }

    if(status==="Cancelled"){
      return {...base,
        tone:"cancelled",
        visibleStatus:"Cancelled",
        eyebrow:"Registration cancelled",
        headline:"This registration has been cancelled.",
        message:"This tournament entry is no longer active.",
        nextTitle:"Need help?",
        nextBody:"Contact the tournament organizer if this cancellation was unexpected or you need assistance.",
        progress:1,
        stopped:true
      };
    }

    return base;
  }

  function lookupProgressMarkup(model){
    const steps=[
      ["Registration Received","Your entry is on file."],
      ["Under Review","Eligibility and payment review."],
      ["Approved","Official tournament registration."]
    ];
    return `<div class="lookup-progress" aria-label="Registration progress">
      ${steps.map(([title,copy],i)=>{
        const step=i+1;
        const done=model.progress>step&&!model.stopped;
        const active=model.progress===step;
        const stopped=model.stopped&&model.progress===step;
        return `<div class="lookup-progress-step ${done?"done":""} ${active?"active":""} ${stopped?"stopped":""}">
          <div class="lookup-progress-marker">${done?"✓":step}</div>
          <div><strong>${esc(title)}</strong><span>${esc(copy)}</span></div>
        </div>`;
      }).join("")}
    </div>`;
  }

  function lookupPlayerSummary(record){
    const player1=lookupPlayerName(record?.player1);
    const hasPlayer2=record?.registrationType==="pair"&&(record?.player2?.firstName||record?.player2?.lastName);
    const player2=hasPlayer2?lookupPlayerName(record.player2):record?.registrationType==="invite"?"Partner completion pending":"";
    return `<div class="lookup-player-list">
      <div><span>Player 1</span><strong>${esc(player1)}</strong></div>
      ${player2?`<div><span>Player 2</span><strong>${esc(player2)}</strong></div>`:""}
    </div>`;
  }

  function lookupOrganizerContact(){
    const email=String(config.contact?.email||"").trim();
    const mobile=String(config.contact?.mobile||"").trim();
    const parts=[];
    if(email&&!placeholder(email))parts.push(email);
    if(mobile&&!placeholder(mobile))parts.push(mobile);
    return parts.join(" · ");
  }

  function lookupResultMarkup(record){
    const model=lookupStatusModel(record);
    const division=lookupDivisionName(record);
    const level=lookupLevelLabel(record);
    const category=lookupCategoryLabel(record);
    const verification=lookupVerificationLabel(record);
    const payment=lookupPaymentLabel(record);
    const contact=lookupOrganizerContact();

    return `<div class="lookup-status-dashboard lookup-tone-${esc(model.tone)}">
      <section class="lookup-status-hero">
        <div class="lookup-status-icon" aria-hidden="true">${model.tone==="approved"?"✓":model.tone==="rejected"?"!":model.tone==="cancelled"?"×":"⌁"}</div>
        <div class="lookup-status-copy">
          <div class="lookup-status-topline">
            <span class="lookup-status-eyebrow">${esc(model.eyebrow)}</span>
            <span class="lookup-friendly-status">${esc(model.visibleStatus)}</span>
          </div>
          <h2>${esc(model.headline)}</h2>
          <p>${esc(model.message)}</p>
        </div>
      </section>

      ${lookupProgressMarkup(model)}

      <section class="lookup-summary-card">
        <div class="lookup-summary-head">
          <div>
            <span class="lookup-summary-label">Registration reference</span>
            <strong class="lookup-reference">${esc(record.reference||"—")}</strong>
          </div>
          <span class="lookup-raw-status">${esc(model.visibleStatus)}</span>
        </div>

        ${lookupPlayerSummary(record)}

        <div class="lookup-facts-grid">
          <div><span>Division</span><strong>${esc(division)}</strong></div>
          <div><span>Playing level</span><strong>${esc(level)}</strong></div>
          <div><span>Category</span><strong>${esc(category)}</strong></div>
          <div><span>Level status</span><strong>${esc(verification)}</strong></div>
          <div><span>Payment</span><strong>${esc(payment)}</strong></div>
          <div><span>Tournament date</span><strong>${esc(publicDate(config.eventDate))}</strong></div>
        </div>
      </section>

      <section class="lookup-next-card">
        <div class="lookup-next-icon" aria-hidden="true">→</div>
        <div>
          <span>What happens next?</span>
          <h3>${esc(model.nextTitle)}</h3>
          <p>${esc(model.nextBody)}</p>
          ${contact&&["Declined","Withdrawn","Cancelled"].includes(model.raw)?`<small>Organizer contact: ${esc(contact)}</small>`:""}
        </div>
      </section>

      <p class="lookup-privacy-note">For your privacy, contact details, birth dates, DUPR proof images, and payment information are not displayed on this public status page.</p>
    </div>`;
  }

  async function refreshTrackerSilently(){
    if(document.hidden)return;
    if(!backendCompatible)return;
    if(!lastLookupCredentials?.reference||!lastLookupCredentials?.identity)return;
    if(!["lookup","confirmation"].includes(document.body.dataset.activeView))return;

    try{
      const response=await registrationApiJson({
        action:"lookup",
        reference:lastLookupCredentials.reference,
        identity:lastLookupCredentials.identity
      });
      if(!response?.verified||!response?.record)return;

      if(document.body.dataset.activeView==="lookup"){
        const out=$("#lookupResult");
        if(out)out.innerHTML=lookupResultMarkup(response.record);
      }

      if(document.body.dataset.activeView==="confirmation"){
        const previous=publicWorkflowStatus(state.status);
        state.status=publicWorkflowStatus(response.record.status||state.status);
        renderConfirmation();
        const statusModel=lookupStatusModel(response.record);
        const statusNode=$("#confirmationStatus");
        if(statusNode){
          statusNode.textContent=statusModel.visibleStatus;
          statusNode.dataset.status=statusModel.visibleStatus.toLowerCase().replace(/\s+/g,"-");
        }
        const message=$("#confirmationEmailMessage");
        if(message&&previous!==state.status){
          if(state.status==="Approved")message.textContent="Your team is officially approved for the tournament. Keep your registration reference and watch for schedule and player-guide announcements.";
          if(state.status==="Declined")message.textContent="The organizer has declined this registration. Contact the tournament team if you need clarification.";
          if(state.status==="Withdrawn")message.textContent="This approved registration has been withdrawn from the active tournament roster. Contact the organizer if you need clarification.";
        }
        if(previous!==state.status){
          showToast(`Registration status updated: ${statusModel.visibleStatus}`);
        }
      }
    }catch(error){
      console.warn("Automatic tracker refresh failed:",error);
    }
  }

  function startTrackerRefresh(){
    clearInterval(trackerRefreshTimer);
    trackerRefreshTimer=null;
    if(document.hidden)return;
    trackerRefreshTimer=setInterval(refreshTrackerSilently,60000);
  }

  async function lookup(event){
    event.preventDefault();
    const ref=$("#lookupReference").value.trim().toUpperCase();
    const identity=$("#lookupIdentity").value.trim();
    const out=$("#lookupResult");
    const submit=$("#lookupForm button[type='submit']");

    if(!ref||!identity){
      out.innerHTML=`<div class="lookup-error">Enter your registration reference and the email or mobile number used by either player.</div>`;
      return;
    }

    submit.disabled=true;
    submit.textContent="Checking…";
    out.innerHTML=`<div class="lookup-loading">Checking the live tournament registration database…</div>`;

    try{
      const response=await registrationApiJson({
        action:"lookup",
        reference:ref,
        identity
      });

      if(!response.verified||!response.record){
        out.innerHTML=`<div class="lookup-error">We couldn't verify that registration. Check the reference and the email or mobile number used by Player 1 or Player 2.</div>`;
        return;
      }

      lastLookupCredentials={reference:ref,identity};
      out.innerHTML=lookupResultMarkup(response.record);
      startTrackerRefresh();
      out.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(error){
      console.warn(error);
      out.innerHTML=`<div class="lookup-error">${esc(error?.message||"The registration service is temporarily unavailable.")}</div>`;
    }finally{
      submit.disabled=false;
      submit.textContent="Check Registration";
    }
  }

  function downloadICS(){
    if(placeholder(config.eventDate)){showToast('Event date must be configured first');return}
    const compact=config.eventDate.replace(/-/g,'');const content=`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:${compact}\nSUMMARY:${config.name}\nLOCATION:${config.venue}\nEND:VEVENT\nEND:VCALENDAR`;
    downloadBlob(content,'animo-pickleball-cup-2026.ics','text/calendar');
  }
  function downloadBlob(content,name,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}
  function printSummary(){window.print()}

  async function handleAction(a){
    switch(a){
      case "home":
        showView("landing");
        return;
      case "register":
        if(!await ensureProductionBackend({refreshPortal:true}))return;
        state.registrationType="pair";
        state.step=Math.max(0,Math.min(state.step,stepDefs.length-1));
        sanitizeDivisionSelection();
        showView("registration");
        renderStep();
        return;
      case "lookup":
        showView("lookup");
        return;
      case "details":
        showView("landing");
        requestAnimationFrame(()=>{
          const details=$("#detailsSection");
          if(details)details.scrollIntoView({behavior:"smooth",block:"start"});
        });
        return;
    }
  }
  function bindGlobal(){
    $$('[data-action]').forEach(btn=>{
      btn.addEventListener('click',async event=>{
        event.preventDefault();
        await handleAction(btn.dataset.action);
      });
    });

    const heroPrev=$("#heroPrev");
    const heroNext=$("#heroNext");
    const heroPause=$("#heroPause");
    if(heroPrev)heroPrev.onclick=()=>setHeroSlide(heroIndex-1,true);
    if(heroNext)heroNext.onclick=()=>setHeroSlide(heroIndex+1,true);
    if(heroPause)heroPause.onclick=toggleHeroPause;
    const heroCarousel=$("#heroCarousel");
    if(heroCarousel){
      heroCarousel.addEventListener("touchstart",e=>{heroTouchStartX=e.changedTouches?.[0]?.clientX??null},{passive:true});
      heroCarousel.addEventListener("touchend",e=>{if(heroTouchStartX==null)return;const end=e.changedTouches?.[0]?.clientX??heroTouchStartX;const delta=end-heroTouchStartX;heroTouchStartX=null;if(Math.abs(delta)>52)setHeroSlide(heroIndex+(delta<0?1:-1),true)},{passive:true});
    }
    document.addEventListener("visibilitychange",()=>{
      if(document.hidden){
        clearInterval(heroTimer);
        clearInterval(trackerRefreshTimer);
        trackerRefreshTimer=null;
      }else{
        if($("#landingView")?.classList.contains("is-active"))restartHeroTimer();
        if(["lookup","confirmation"].includes(document.body.dataset.activeView)){
          refreshTrackerSilently();
          startTrackerRefresh();
        }
      }
    });
    const backButton=$("#backButton");if(backButton)backButton.onclick=()=>{if(state.step>0){state.step--;renderStep()}};

    const registrationTop=$("#registrationView .registration-topbar");
    if(registrationTop&&!$("#clearSavedDraftButton")){
      const clearDraft=document.createElement("button");
      clearDraft.id="clearSavedDraftButton";
      clearDraft.type="button";
      clearDraft.className="button button-ghost clear-draft-button";
      clearDraft.textContent="Clear Saved Draft";
      clearDraft.onclick=()=>{
        if(!confirm("Clear the saved registration draft on this device? This does not affect submitted registrations."))return;
        clearSavedDraft({silent:true});
        location.reload();
      };
      registrationTop.appendChild(clearDraft);
    }
    const nextButton=$("#nextButton");if(nextButton)nextButton.onclick=()=>{if(state.step===stepDefs.length-1){submitRegistration();return}if(validateStep()){state.step++;renderStep();window.scrollTo({top:0,behavior:'smooth'})}};
    const lookupForm=$("#lookupForm");if(lookupForm)lookupForm.addEventListener('submit',lookup);
    const modalClose=$("#modalClose");if(modalClose)modalClose.onclick=()=>$("#modal")?.close();
    const copyReference=$("#copyReference");if(copyReference)copyReference.onclick=async()=>{try{await navigator.clipboard.writeText(state.reference);showToast('Registration reference copied')}catch{showToast('Copy unavailable')}};
    const viewRegistrationButton=$("#viewRegistrationButton");if(viewRegistrationButton)viewRegistrationButton.onclick=()=>{showView('lookup');const ref=$("#lookupReference");const identity=$("#lookupIdentity");if(ref)ref.value=state.reference;if(identity)identity.value=state.player1.email||state.player1.mobile||'';lookup({preventDefault(){}})};
    const printSummaryButton=$("#printSummaryButton");if(printSummaryButton)printSummaryButton.onclick=printSummary;const calendarButton=$("#calendarButton");if(calendarButton)calendarButton.onclick=downloadICS;
    window.addEventListener('beforeunload',saveDraft);
  }

  loadDraft();
  document.body.dataset.activeView="landing";
  bindGlobal();

  try{
    renderLanding();
  }catch(error){
    console.error("Landing content could not be fully rendered:",error);
    showToast("Some tournament content could not be loaded. Navigation is still available.");
  }

  (async()=>{
    const compatible=await checkBackendCompatibility();
    if(!compatible){
      console.error(backendCheckError);
      return;
    }

    try{
      await loadLivePortalState();
      renderLanding();
    }catch(error){
      console.error("Live tournament state failed:",error);
    }

    loadLivePaymentMethods().catch(error=>console.warn("Payment methods preload failed:",error));
  })();
})();
