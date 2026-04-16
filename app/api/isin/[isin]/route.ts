import { NextResponse } from 'next/server';

export async function GET(request: Request, { params }: { params: Promise<{ isin: string }> }) {
  const { isin } = await params;
  const isinUpper = isin.toUpperCase();
  
  try {
    // Use OpenFIGI API to resolve ISIN details
    const figiRes = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([{ idType: 'ID_ISIN', idValue: isinUpper }])
    });
    
    if (figiRes.ok) {
      const figiData = await figiRes.json();
      if (figiData && figiData[0] && figiData[0].data && figiData[0].data.length > 0) {
        const match = figiData[0].data[0];
        const typeStr = (match.securityType || '').toUpperCase();
        const isDebt = typeStr.includes('CORP') || typeStr.includes('BOND') || typeStr.includes('DEBT');
        
        return NextResponse.json({
          success: true,
          data: {
            isin: isinUpper,
            description: match.securityDescription || match.name || isinUpper,
            issuer: match.name || 'Unknown',
            type: isDebt ? 'DEBT' : 'FIXED INCOME',
            status: 'ACTIVE'
          }
        });
      }
    }
    
    // Fallback if not found
    return NextResponse.json({
      success: true,
      data: {
        isin: isinUpper,
        description: `Unknown ISIN (${isinUpper})`,
        issuer: 'Unknown',
        type: 'FIXED INCOME',
        status: 'UNKNOWN'
      }
    });
  } catch (error) {
    console.error("Error fetching ISIN:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
