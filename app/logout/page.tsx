'use client';
import {useState} from 'react';
export default function Logout(){const [error,setError]=useState('');return <main className="welcome"><h1>تسجيل الخروج</h1><p>هل تريد إنهاء هذه الجلسة؟</p><button className="button primary" onClick={async()=>{try{const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'logout'})});if(!r.ok)throw Error();location.assign('/login')}catch{setError('تعذر تسجيل الخروج. حاول مجددًا.')}}}>تأكيد تسجيل الخروج</button> <a className="button" href="/">عودة</a><p role="alert">{error}</p></main>}
