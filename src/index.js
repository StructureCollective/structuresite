// Cloudflare Worker entry point for structuresite.
//
// This Worker serves the static site (everything under this repo) for all
// routes, and handles two POST endpoints itself, both sending mail via
// Resend:
//   POST /api/testimonial — forwards a submitted testimonial to the admin
//     inbox.
//   POST /api/contact — forwards a contact form submission to the admin
//     inbox, and sends a branded HTML confirmation back to the submitter.
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CONTACT_SERVICES = [
  'Workflow Optimization',
  'Brand Development',
  'Website Design',
  'Technology Integration',
  'Operational Systems',
  'Project Coordination',
  'Not sure / just exploring',
];

async function sendResendEmail(env, { to, from, subject, html }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error('Resend error', response.status, errText);
    throw new Error(`Resend responded with ${response.status}`);
  }
  return response;
}

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
    await sendResendEmail(env, {
      from: env.FROM_EMAIL || 'Structure Collective <testimonials@structurecollective.com>',
      to: env.ADMIN_EMAIL || 'admin@structurecollective.com',
      subject: `Testimonial from ${name}`,
      html,
    });
  } catch (err) {
    console.error('Testimonial send failed', err);
    return new Response(JSON.stringify({ error: 'Could not send testimonial. Please try again later.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleContact(request, env) {
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
  const email = (data.email || '').toString().trim();
  const phone = (data.phone || '').toString().trim();
  const message = (data.message || '').toString().trim();
  const rawServices = Array.isArray(data.services) ? data.services : [];
  const services = rawServices
    .map((s) => (s || '').toString().trim())
    .filter((s) => CONTACT_SERVICES.includes(s));

  if (!name || !email) {
    return new Response(JSON.stringify({ error: 'Name and email are required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: 'Please enter a valid email address.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (name.length > 200 || email.length > 200 || phone.length > 60 || message.length > 5000) {
    return new Response(JSON.stringify({ error: 'One of the fields is too long.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not configured for this Worker.');
    return new Response(JSON.stringify({ error: 'The contact form is not configured yet. Please email us directly instead.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const fromAddress = env.FROM_EMAIL || 'Structure Collective <admin@structurecollective.com>';
  const adminAddress = env.ADMIN_EMAIL || 'admin@structurecollective.com';
  const servicesList = services.length ? services : ['Not specified'];

  // --- Admin notification -------------------------------------------------
  const adminHtml = `
    <div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#07172c;margin:0 0 16px;">New contact form submission</h2>
      <p style="margin:0 0 8px;"><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p style="margin:0 0 8px;"><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${phone ? `<p style="margin:0 0 8px;"><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : ''}
      <p style="margin:0 0 16px;"><strong>Services needed:</strong> ${escapeHtml(servicesList.join(', '))}</p>
      ${message ? `
        <p style="margin:0 0 8px;"><strong>Message:</strong></p>
        <p style="white-space:pre-wrap;background:#fbfaf7;border:1px solid #e7e4df;padding:16px;margin:0;">${escapeHtml(message)}</p>
      ` : '<p style="margin:0;color:#606a76;">No additional message left.</p>'}
    </div>
  `;

  try {
    await sendResendEmail(env, {
      from: fromAddress,
      to: adminAddress,
      subject: `New contact form submission from ${name}`,
      html: adminHtml,
    });
  } catch (err) {
    console.error('Contact admin notification failed', err);
    return new Response(JSON.stringify({ error: 'Could not send your message. Please try again later or email us directly.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Confirmation email back to the submitter, branded HTML ------------
  const servicesLine = services.length
    ? escapeHtml(services.join(', '))
    : "what you're looking for";

  const confirmationHtml = `
<div id="email-content" style="font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fbfaf7;">

  <div style="padding:28px 32px 20px;text-align:left;">
    <img src="https://structurecollective.com/assets/images/structure-collective-logo.png" alt="Structure Collective" style="height:48px;width:auto;display:block;">
  </div>

  <div style="background:#ffffff;margin:0 24px;border:1px solid #e7e4df;box-shadow:0 18px 50px rgba(7,23,44,0.09);">

    <div style="background:#07172c;padding:26px 36px;">
      <p style="margin:0;color:#ffffff;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:600;letter-spacing:.01em;">Thanks for reaching out</p>
    </div>

    <div style="padding:34px 36px 8px;color:#07172c;font-size:15px;line-height:1.65;">
      <p style="margin:0 0 18px;">Hi, ${escapeHtml(name)}</p>

      <p style="margin:0 0 18px;">We received your message about ${servicesLine}, thank you for taking the time to reach out. Someone from our team will get back to you within 1-2 business days.</p>

      ${message ? `
      <div style="background:#fbfaf7;border:1px solid #e7e4df;padding:18px 20px;margin:0 0 24px;">
        <p style="margin:0 0 8px;font-weight:700;color:#07172c;">What you sent us</p>
        <p style="margin:0;white-space:pre-wrap;color:#606a76;">${escapeHtml(message)}</p>
      </div>
      ` : ''}

      <p style="margin:0 0 18px;">If you'd rather not wait, feel free to grab a time on our calendar directly:</p>

      <div style="text-align:left;margin:0 0 28px;">
        <a href="https://structurecollective.com/schedule/" style="display:inline-block;background:#f26a16;color:#ffffff;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:.035em;font-size:13px;padding:0 24px;line-height:48px;min-height:48px;">Schedule a Consultation</a>
      </div>

      <p style="margin:0 0 18px;font-size:14px;color:#4a5568;">Or just reply to this email, either works.</p>

      <p style="margin:0 0 6px;">Talk soon,</p>
      <p style="margin:0 0 28px;">Best,<br>B. Nickole | Owner<br>Structure Collective</p>
    </div>
  </div>

  <div style="background:#07172c;padding:26px 36px;margin-top:24px;text-align:center;">
    <div style="margin:0 0 6px;">
      <img src="https://structurecollective.com/assets/images/favicon-192.png" alt="" width="16" height="16" style="height:16px;width:16px;vertical-align:middle;margin-right:6px;">
      <span style="color:#bcc7d5;font-size:12px;letter-spacing:.02em;vertical-align:middle;">Structure Collective</span>
    </div>
    <p style="margin:0;color:#91a0b2;font-size:11px;">structurecollective.com</p>
  </div>

</div>
  `;

  try {
    await sendResendEmail(env, {
      from: fromAddress,
      to: email,
      subject: `Thanks for reaching out, ${name}!`,
      html: confirmationHtml,
    });
  } catch (err) {
    // The lead already reached the admin inbox above, which is what matters
    // most. Log this so it can be noticed, but don't fail the request over
    // a confirmation email the submitter may not even miss.
    console.error('Contact confirmation email failed', err);
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

    if (url.pathname === '/api/contact') {
      if (request.method === 'POST') {
        return handleContact(request, env);
      }
      return new Response('Method not allowed', { status: 405 });
    }

    // Everything else: serve the static site as before.
    return env.ASSETS.fetch(request);
  },
};
