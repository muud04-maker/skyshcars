import { welcomeConfig } from '../lib/welcome';
import GroupBannerClient from './GroupBannerClient';

/*
  Public WhatsApp-group invitation. Uses the group link stored in business_settings (the same value
  the first-contact welcome uses). Missing settings or a database problem just hide the banner.
*/
export default async function WhatsAppGroupBanner() {
  try {
    const cfg = await welcomeConfig();
    if (!cfg?.enabled || !cfg.groupLink) return null;
    return <GroupBannerClient link={cfg.groupLink} name={cfg.groupName} />;
  } catch { return null; }
}
