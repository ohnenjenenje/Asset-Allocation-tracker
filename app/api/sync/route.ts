import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { uid, email, displayName, data } = body;

    if (!uid) {
      return NextResponse.json({ success: false, error: 'Missing UID' }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db('portfolio_tracker');

    // Update or insert the user document in MongoDB
    // We use the uid as the _id or just store it as a field. Let's store it as a field and use upsert.
    await db.collection('users').updateOne(
      { uid: uid },
      {
        $set: {
          uid,
          email,
          displayName,
          ...data,
          lastSynced: new Date()
        }
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
