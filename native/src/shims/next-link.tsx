import { forwardRef } from "react";
import { navigate } from "./router";

/**
 * Remplacement de `next/link` dans l'application native : un <a> classique
 * dont le clic gauche (sans touche de modification) navigue sans recharger.
 */
type Props = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname: string; query?: Record<string, string> };
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, prefetch, replace, scroll, onClick, ...rest }, ref) {
  void prefetch;
  const url = typeof href === "string" ? href : href.pathname + (href.query ? "?" + new URLSearchParams(href.query).toString() : "");
  return (
    <a
      ref={ref}
      href={url}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === "_blank") return;
        // Téléchargements de documents : laissés au navigateur / à la coque.
        if (url.startsWith("/api/") || url.startsWith("/media/")) return;
        e.preventDefault();
        navigate(url, { replace, scroll });
      }}
    />
  );
});

export default Link;
