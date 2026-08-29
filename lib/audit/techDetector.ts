export interface DetectedTech {
  name: string
  category: "cms" | "analytics" | "chat" | "booking" | "crm" | "field-service"
}

const SIGNATURES: Array<{ name: string; category: DetectedTech["category"]; pattern: RegExp }> = [
  // CMS / builders
  { name: "WordPress", category: "cms", pattern: /wp-content|wp-includes|\/wp-json\// },
  { name: "Wix", category: "cms", pattern: /wix\.com|wixstatic\.com|_wixCIDX/ },
  { name: "Squarespace", category: "cms", pattern: /squarespace\.com|static1\.squarespace/ },
  { name: "Shopify", category: "cms", pattern: /cdn\.shopify\.com|Shopify\.theme/ },
  { name: "Webflow", category: "cms", pattern: /webflow\.com|data-wf-site/ },
  { name: "GoDaddy Website Builder", category: "cms", pattern: /godaddysites\.com|godaddy\.com\/websites/ },

  // Analytics
  { name: "Google Analytics", category: "analytics", pattern: /gtag\(['"]config['"]|google-analytics\.com\/analytics\.js|googletagmanager\.com\/gtag/ },
  { name: "Google Tag Manager", category: "analytics", pattern: /googletagmanager\.com\/gtm\.js/ },
  { name: "Meta Pixel", category: "analytics", pattern: /connect\.facebook\.net\/[^"']*\/fbevents\.js/ },

  // Chat / chatbot providers already in use
  { name: "Intercom", category: "chat", pattern: /widget\.intercom\.io|intercomSettings/ },
  { name: "Tidio", category: "chat", pattern: /code\.tidio\.co/ },
  { name: "Zendesk Chat", category: "chat", pattern: /static\.zdassets\.com|zopim/ },
  { name: "GoHighLevel", category: "chat", pattern: /leadconnectorhq\.com|highlevel\.com/ },
  { name: "Tawk.to", category: "chat", pattern: /embed\.tawk\.to/ },
  { name: "Drift", category: "chat", pattern: /js\.driftt\.com/ },
  { name: "Crisp", category: "chat", pattern: /client\.crisp\.chat/ },

  // Booking
  { name: "Calendly", category: "booking", pattern: /calendly\.com/ },
  { name: "Setmore", category: "booking", pattern: /setmore\.com/ },
  { name: "Acuity Scheduling", category: "booking", pattern: /acuityscheduling\.com/ },

  // CRM / field service (relevant to "disconnected systems" / ERP opportunity)
  { name: "HubSpot", category: "crm", pattern: /js\.hs-scripts\.com|hubspot\.com\/forms/ },
  { name: "Salesforce", category: "crm", pattern: /force\.com|salesforce\.com\/embeddedservice/ },
  { name: "ServiceM8", category: "field-service", pattern: /servicem8\.com/ },
  { name: "Jobber", category: "field-service", pattern: /getjobber\.com/ },
  { name: "Tradify", category: "field-service", pattern: /tradifyhq\.com/ },
  { name: "simPRO", category: "field-service", pattern: /simprogroup\.com|simpro\.co/ },
  { name: "Housecall Pro", category: "field-service", pattern: /housecallpro\.com/ },
]

export function detectTech(html: string): DetectedTech[] {
  const found: DetectedTech[] = []
  for (const sig of SIGNATURES) {
    if (sig.pattern.test(html)) found.push({ name: sig.name, category: sig.category })
  }
  return found
}
