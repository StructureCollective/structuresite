// Cloudflare Worker entry point for structuresite.
//
// This Worker serves the static site (everything under this repo) for all
// routes, and handles POST /api/testimonial itself, sending the submission
// to the Structure Collective admin inbox via Resend.
//
// Requires the RESEND_API_KEY environment variable/secret to be set on this
// Worker (Cloudflare dashboard -> Workers & Pages -> structuresite ->
// Settings -> Variables and Secrets). Optional overrides: FROM_EMAIL,
// ADMIN_EMAIL.

const escapeHtml = (str) =>
  str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

async function handleTestimonial(request, env) {
  let data;
  try {
    data = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const name = (data.name || '').toString().trim();
  const company = (data.company || '').toString().trim();
  const testimonial = (data.testimonial || '').toString().trim();
  const consent = data.consent ? 'Yes' : 'No';

  if (!name || !testimonial) {
    return new Response(JSON.stringify({ error: 'Name and testimonial are required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (name.length > 200 || company.length > 200 || testimonial.length > 5000) {
    return new Response(JSON.stringify({ error: 'One of the fields is too long.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not configured for this Worker.');
    return new Response(JSON.stringify({ error: 'Testimonial submissions are not configured yet. Please try again later.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const html = `
    <div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#07172c;margin:0 0 16px;">New testimonial submitted</h2>
      <p style="margin:0 0 8px;"><strong>Name:</strong> ${escapeHtml(name)}</p>
      ${company ? `<p style="margin:0 0 8px;"><strong>Company / role:</strong> ${escapeHtml(company)}</p>` : ''}
      <p style="margin:0 0 16px;"><strong>Okay to use publicly:</strong> ${consent}</p>
      <p style="margin:0 0 8px;"><strong>Testimonial:</strong></p>
      <p style="white-space:pre-wrap;background:#fbfaf7;border:1px solid #e7e4df;padding:16px;margin:0;">${escapeHtml(testimonial)}</p>
    </div>
  `;

  try {
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL || 'Structure Collective <testimonials@mail.structurecollective.com>',
        to: env.ADMIN_EMAIL || 'admin@structurecollective.com',
        subject: `Testimonial from ${name}`,
        html,
      }),
    });

    if (!resendResponse.ok) {
      const errText = await resendResponse.text();
      console.error('Resend error', resendResponse.status, errText);
      return new Response(JSON.stringify({ error: 'Could not send testimonial. Please try again later.' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    console.error('Testimonial send failed', err);
    return new Response(JSON.stringify({ error: 'Could not send testimonial. Please try again later.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/testimonial') {
      if (request.method === 'POST') {
        return handleTestimonial(request, env);
      }
      return new Response('Method not allowed', { status: 405 });
    }

    // Everything else: serve the static site as before.
    return env.ASSETS.fetch(request);
  },
};
