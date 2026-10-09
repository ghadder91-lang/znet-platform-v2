import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'زد نت | إدارة الشبكات',description:'إدارة الشبكات والفئات ومخزون الكروت',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl"><body>{children}</body></html>}
