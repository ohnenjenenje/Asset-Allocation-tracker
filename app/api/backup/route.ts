import { NextResponse } from 'next/server';
import fs from 'fs';
export async function GET() {
  try {
    const data = fs.readFileSync('/tmp/old_assets.json', 'utf8');
    return NextResponse.json({ success: true, data: JSON.parse(data) });
  } catch(e) {
    return NextResponse.json({ error: String(e) });
  }
}
