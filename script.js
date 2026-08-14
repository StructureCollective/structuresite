(() => {
  const config = window.STRUCTURE_COLLECTIVE_CONFIG || {};
  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.primary-nav');

  if (menuButton && nav) {
    menuButton.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menuButton.setAttribute('aria-expanded', String(open));
    });
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
      nav.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
    }));
  }

  const email = config.email || 'admin@structurecollective.com';
  const subject = encodeURIComponent(config.consultationSubject || 'Consultation Request');
  document.querySelectorAll('[data-consultation-link]').forEach(link => link.href = `mailto:${email}?subject=${subject}`);
  document.querySelectorAll('[data-email-link]').forEach(link => {
    link.href = `mailto:${email}`;
    link.textContent = email;
  });
  document.querySelectorAll('[data-location]').forEach(node => node.textContent = config.location || 'Greensboro, NC');

  const wireSocial = (selector, url) => {
    document.querySelectorAll(selector).forEach(link => {
      if (url) {
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else {
        link.hidden = true;
      }
    });
  };
  wireSocial('[data-instagram-link]', config.instagram);
  wireSocial('[data-linkedin-link]', config.linkedin);

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .12 });
    reveals.forEach(node => observer.observe(node));
  } else {
    reveals.forEach(node => node.classList.add('visible'));
  }

  const sections = [...document.querySelectorAll('main section[id], header[id]')];
  const navLinks = [...document.querySelectorAll('.primary-nav a')];
  const updateActive = () => {
    let current = 'home';
    sections.forEach(section => {
      if (window.scrollY >= section.offsetTop - 180) current = section.id;
    });
    navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${current}`));
  };
  window.addEventListener('scroll', updateActive, { passive: true });
  updateActive();
})();
