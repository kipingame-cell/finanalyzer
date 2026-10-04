// Russian bank records use Moscow time regardless of the device/VPN timezone.
export function bankDateKey(value) {
 const n=value instanceof Date?value.getTime():typeof value==='number'?value:Date.parse(value);
 return Number.isFinite(n)?new Date(n+10800000).toISOString().slice(0,10):'';
}
export function bankInput(value=new Date().toISOString()) {
 const n=Date.parse(value);return Number.isFinite(n)?new Date(n+10800000).toISOString().slice(0,16):'';
}
export function fromBankInput(value) {
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null;
 const n=Date.parse(value+':00+03:00');
 if(!Number.isFinite(n))return null;
 const iso=new Date(n).toISOString();return bankInput(iso)===value?iso:null;
}
