import { handleRequest } from '$lib/server/shareTarget';

export async function GET(event: any) { return handleRequest(event); }
export async function POST(event: any) { return handleRequest(event); }
export async function PATCH(event: any) { return handleRequest(event); }
export async function DELETE(event: any) { return handleRequest(event); }
