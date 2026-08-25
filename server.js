const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const cache = new Map();

app.use(express.static(path.join(__dirname, "public")));

const EVENT_TERMS = [
  "Flohmarkt", "Trödelmarkt", "Stadtfest", "Kirmes", "Schützenfest",
  "Wochenmarkt", "Markt", "Familienfest", "Kinderfest", "Vereinsfest",
  "Feuerwehrfest", "Sommerfest", "Straßenfest", "Bürgerfest",
  "Weihnachtsmarkt", "Ostermarkt", "Kunstmarkt", "Oldtimertreffen",
  "Dorffest", "Weinfest", "verkaufsoffener Sonntag", "Veranstaltung"
];

const QUERY_GROUPS = [
  "Flohmarkt OR Trödelmarkt OR Markt",
  "Stadtfest OR Straßenfest OR Bürgerfest OR Dorffest",
  "Kirmes OR Schützenfest OR Vereinsfest OR Feuerwehrfest",
  "Familienfest OR Kinderfest OR Sommerfest",
  "Weihnachtsmarkt OR Ostermarkt OR Kunstmarkt OR Weinfest",
  "\"verkaufsoffener Sonntag\" OR Veranstaltung OR Veranstaltungen"
];

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function stripHtml(s=""){
  return s.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/\s+/g," ").trim();
}

function decodeXml(s=""){
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
    .replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">");
}

function getTag(block, tag){
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeXml(m[1]).trim() : "";
}

function parseRss(xml){
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return blocks.map(b => ({
    title: stripHtml(getTag(b,"title")),
    link: stripHtml(getTag(b,"link")),
    description: stripHtml(getTag(b,"description")),
    pubDate: stripHtml(getTag(b,"pubDate")),
    source: stripHtml(getTag(b,"source"))
  }));
}

function normalizeTitle(t=""){
  return t.toLowerCase()
    .replace(/\s+-\s+[^-]{2,40}$/,"")
    .replace(/[^\p{L}\p{N}]+/gu," ")
    .trim();
}

function classify(text=""){
  const t=text.toLowerCase();
  if(/flohmarkt|trödel/.test(t)) return "Flohmarkt";
  if(/weihnachtsmarkt|ostermarkt|kunstmarkt|wochenmarkt|\bmarkt\b/.test(t)) return "Markt";
  if(/kirmes/.test(t)) return "Kirmes";
  if(/schützenfest/.test(t)) return "Schützenfest";
  if(/familienfest|kinderfest/.test(t)) return "Familie";
  if(/vereinsfest|feuerwehrfest/.test(t)) return "Verein";
  if(/stadtfest|straßenfest|bürgerfest|dorffest|sommerfest|weinfest/.test(t)) return "Stadtfest";
  if(/verkaufsoffener sonntag/.test(t)) return "Shopping";
  return "Veranstaltung";
}

const MONTHS = {
  januar:1, februar:2, märz:3, maerz:3, april:4, mai:5, juni:6, juli:7,
  august:8, september:9, oktober:10, november:11, dezember:12
};

function inferEventDate(text, published){
  const now = new Date();
  let year = now.getFullYear();
  const pub = published ? new Date(published) : null;
  if(pub && !isNaN(pub)) year = pub.getFullYear();

  let m = text.match(/\b([0-3]?\d)\.([01]?\d)\.(20\d{2})\b/);
  if(m) return `${m[3]}-${String(+m[2]).padStart(2,"0")}-${String(+m[1]).padStart(2,"0")}`;

  m = text.match(/\b([0-3]?\d)\.([01]?\d)\.\b/);
  if(m){
    let y = year;
    const candidate = new Date(y, +m[2]-1, +m[1]);
    if(candidate < new Date(now.getTime()-60*86400000)) y++;
    return `${y}-${String(+m[2]).padStart(2,"0")}-${String(+m[1]).padStart(2,"0")}`;
  }

  m = text.toLowerCase().match(/\b([0-3]?\d)\.?\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*(20\d{2})?/);
  if(m){
    let y = m[3] ? +m[3] : year;
    const mo = MONTHS[m[2]];
    const candidate = new Date(y, mo-1, +m[1]);
    if(!m[3] && candidate < new Date(now.getTime()-60*86400000)) y++;
    return `${y}-${String(mo).padStart(2,"0")}-${String(+m[1]).padStart(2,"0")}`;
  }

  return null;
}

function localISO(d){
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}

function periodBounds(mode){
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  let from=null,to=null;

  if(mode==="today"){
    from=today; to=today;
  }else if(mode==="7days"){
    from=today; to=new Date(today); to.setDate(to.getDate()+6);
  }else if(mode==="weekend"){
    const day=today.getDay();
    const daysToSat=(6-day+7)%7;
    from=new Date(today); from.setDate(from.getDate()+daysToSat);
    to=new Date(from); to.setDate(to.getDate()+1);
  }

  return {from:from?localISO(from):null,to:to?localISO(to):null};
}

function haversine(a,b){
  const R=6371, toRad=x=>x*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLon=toRad(b.lon-a.lon);
  const la1=toRad(a.lat), la2=toRad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

async function geocodePostcode(plz){
  const r = await fetch(`https://api.zippopotam.us/de/${encodeURIComponent(plz)}`);
  if(!r.ok) throw new Error("Postleitzahl nicht gefunden.");
  const data = await r.json();
  const p = data.places && data.places[0];
  if(!p) throw new Error("Postleitzahl nicht gefunden.");
  return {name:p["place name"], lat:+p.latitude, lon:+p.longitude};
}

async function nearbyPlaces(center, radiusKm){
  const radiusM = Math.min(Math.max(+radiusKm,5),100)*1000;
  const query = `[out:json][timeout:12];
    node(around:${radiusM},${center.lat},${center.lon})["place"~"city|town|village|suburb"];
    out tags center 100;`;

  try{
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        "User-Agent":"Lokale-Events-App/1.0"
      },
      body:"data="+encodeURIComponent(query)
    });

    if(!r.ok) return [center.name];

    const data=await r.json();
    const seen=new Set([center.name.toLowerCase()]);
    const list=[{name:center.name,dist:0}];

    for(const el of data.elements||[]){
      const name=el.tags && el.tags.name;
      if(!name || seen.has(name.toLowerCase())) continue;
      const dist=haversine(center,{lat:el.lat,lon:el.lon});
      if(dist<=radiusKm){
        seen.add(name.toLowerCase());
        list.push({name,dist});
      }
    }

    return list.sort((a,b)=>a.dist-b.dist).slice(0,10).map(x=>x.name);
  }catch{
    return [center.name];
  }
}

async function googleNews(query){
  const url="https://news.google.com/rss/search?q="+encodeURIComponent(query)+
    "&hl=de&gl=DE&ceid=DE:de";
  const r=await fetch(url,{headers:{"User-Agent":"Lokale-Events-App/1.0"}});
  if(!r.ok) return [];
  return parseRss(await r.text());
}

function relevant(item, places){
  const t=(item.title+" "+item.description).toLowerCase();
  const hasEvent=EVENT_TERMS.some(x=>t.includes(x.toLowerCase()));
  const hasPlace=places.some(p=>t.includes(p.toLowerCase()));
  return hasEvent && hasPlace;
}

app.get("/api/events", async (req,res)=>{
  try{
    const plz=String(req.query.plz||"").trim();
    const radius=Math.min(Math.max(Number(req.query.radius)||50,5),100);
    const page=Math.max(Number(req.query.page)||0,0);
    const category=String(req.query.category||"").trim();
    const period=String(req.query.period||"all").trim();

    if(!/^\d{5}$/.test(plz)){
      return res.status(400).json({error:"Bitte eine fünfstellige deutsche PLZ eingeben."});
    }

    const key=`${plz}|${radius}|${category}|${period}`;
    let payload=cache.get(key);

    if(!payload || Date.now()-payload.time>10*60*1000){
      const center=await geocodePostcode(plz);
      const places=await nearbyPlaces(center,radius);
      const primaryPlaces=places.slice(0,8);
      let all=[];

      for(const group of QUERY_GROUPS){
        const placePart=primaryPlaces.map(p=>`"${p}"`).join(" OR ");
        const q=`(${placePart}) (${group})`;
        const items=await googleNews(q);
        all.push(...items);
        await sleep(120);
      }

      const dedup=new Map();

      for(const item of all){
        if(!relevant(item,primaryPlaces)) continue;

        const key2=normalizeTitle(item.title);
        if(!key2 || dedup.has(key2)) continue;

        const text=item.title+" "+item.description;
        const cat=classify(text);
        const eventDate=inferEventDate(text,item.pubDate);

        dedup.set(key2,{
          title:item.title,
          url:item.link,
          source:item.source || (item.title.includes(" - ")?item.title.split(" - ").pop():"Lokale Nachricht"),
          published:item.pubDate || null,
          eventDate,
          category:cat,
          matchedPlace:primaryPlaces.find(p=>text.toLowerCase().includes(p.toLowerCase())) || center.name
        });
      }

      let events=[...dedup.values()];

      if(category){
        events=events.filter(e=>e.category===category);
      }

      // Vergangenheit konsequent ausblenden, sobald ein Termin erkannt wurde
      const todayStr=localISO(new Date());
      events=events.filter(e=>!e.eventDate || e.eventDate>=todayStr);

      // Zeitfilter
      if(period!=="all"){
        const bounds=periodBounds(period);
        events=events.filter(e =>
          e.eventDate &&
          (!bounds.from || e.eventDate>=bounds.from) &&
          (!bounds.to || e.eventDate<=bounds.to)
        );
      }

      events.sort((a,b)=>{
        if(a.eventDate && b.eventDate) return a.eventDate.localeCompare(b.eventDate);
        if(a.eventDate) return -1;
        if(b.eventDate) return 1;
        return new Date(b.published||0)-new Date(a.published||0);
      });

      payload={time:Date.now(),center,places:primaryPlaces,events};
      cache.set(key,payload);
    }

    const perPage=10;
    const total=payload.events.length;
    const totalPages=Math.max(Math.ceil(total/perPage),1);
    const start=page*perPage;

    res.json({
      center:payload.center,
      searchedPlaces:payload.places,
      total,
      page,
      totalPages,
      events:payload.events.slice(start,start+perPage),
      note:"Vergangene erkannte Termine werden ausgeblendet. Hinweise ohne eindeutig erkennbares Veranstaltungsdatum können weiterhin erscheinen; maßgeblich ist die Originalquelle."
    });

  }catch(e){
    res.status(500).json({error:e.message||"Suche fehlgeschlagen."});
  }
});

app.listen(PORT,()=>console.log(`Lokale Events App läuft auf Port ${PORT}`));
