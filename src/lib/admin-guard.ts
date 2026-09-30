import {NextResponse} from 'next/server';
import {isAdmin} from './admin';
export async function adminDenied(){return (await isAdmin())?null:NextResponse.json({error:'Unauthorized'},{status:401})}
