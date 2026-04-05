import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db('portfolio_tracker');
    const user = await db.collection('users').findOne({ _id: 'default_user' as any });
    return NextResponse.json(user?.assets || []);
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
