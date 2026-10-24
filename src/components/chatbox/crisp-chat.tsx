import { useEffect } from 'react';
import { isSensitivePath } from '../analytics/privacy';
import { websiteConfig } from '../../config/website';
export function CrispChat() {
  useEffect(() => {
    const id = import.meta.env.VITE_CRISP_WEBSITE_ID;
    if (
      isSensitivePath(window.location.pathname) ||
      !websiteConfig.chatbox.enabled ||
      !id ||
      !/^[a-zA-Z0-9-]+$/.test(id) ||
      document.getElementById('edgekit-crisp')
    )
      return;
    const target = window as Window & { $crisp?: unknown[]; CRISP_WEBSITE_ID?: string };
    target.$crisp ||= [];
    target.CRISP_WEBSITE_ID = id;
    const script = document.createElement('script');
    script.id = 'edgekit-crisp';
    script.src = 'https://client.crisp.chat/l.js';
    script.async = true;
    script.onerror = () => script.remove();
    document.head.appendChild(script);
  }, []);
  return null;
}
