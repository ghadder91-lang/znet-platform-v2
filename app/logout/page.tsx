'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
export default function Logout(){const router=useRouter();const [error,setError]=useState('');return <main className="welcome"><h1>تسجيل الخروج</h1><p>هل تريد إنهاء هذه الجلسة؟</p><button className="button primary" onClick={async()=>{try{const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'logout'})});if(!r.ok)throw Error();router.replace('/login');router.refresh()}catch{setError('تعذر تسجيل الخروج. حاول مجددًا.')}}}>تأكيد تسجيل الخروج</button> <Link className="button" href="/">عودة</Link><p role="alert">{error}</p></main>}
