import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const uid = searchParams.get('uid');

    if (!uid) {
      return NextResponse.json({ success: false, error: 'Missing UID' }, { status: 400 });
    }

    if (!clientPromise) {
      return NextResponse.json({ success: false, error: 'MongoDB not configured' }, { status: 503 });
    }

    const client = await clientPromise;
    const db = client.db('portfolio_tracker');

    const userDoc = await db.collection('users').findOne({ 
      uid: { $in: [uid, null, 'undefined'] }, 
      "assets.0": { $exists: true } 
    });

    if (!userDoc) {
      try {
        const fs = require('fs');
        const localBackup = JSON.parse(fs.readFileSync('/tmp/old_assets.json', 'utf8'));
        return NextResponse.json({ success: true, data: localBackup });
      } catch (e) {
        const fallbackDoc = await db.collection('users').findOne({ uid: uid });
        if (!fallbackDoc) return NextResponse.json({ success: false, error: 'No backup found in MongoDB' }, { status: 404 });
        return NextResponse.json({ success: true, data: fallbackDoc });
      }
    }

    return NextResponse.json({ success: true, data: userDoc });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { uid, email, displayName, data } = body;

    if (!uid) {
      return NextResponse.json({ success: false, error: 'Missing UID' }, { status: 400 });
    }

    if (!clientPromise) {
      return NextResponse.json({ success: false, error: 'MongoDB not configured' }, { status: 503 });
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
