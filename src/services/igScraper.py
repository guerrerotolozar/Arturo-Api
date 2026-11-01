import sys
import json
import instaloader
from datetime import datetime

def extract_comments(shortcode):
    L = instaloader.Instaloader(
        download_pictures=False,
        download_videos=False,
        download_comments=True,
        save_metadata=False,
        compress_json=False
    )
    
    # Intentar cargar cookies frescas desde cookies.txt primero, o sesión guardada
    try:
        import os
        from http.cookiejar import MozillaCookieJar
        
        cookie_path = "/app/config/cookies.txt"
        if os.path.exists(cookie_path):
            print(f"DEBUG: Cargando cookies frescas desde {cookie_path}...", file=sys.stderr)
            cookie_jar = MozillaCookieJar(cookie_path)
            cookie_jar.load(ignore_discard=True, ignore_expires=True)
            L.context._session.cookies.update(cookie_jar)
            print("DEBUG: Cookies inyectadas en Instaloader exitosamente.", file=sys.stderr)
        else:
            import glob
            sessions = glob.glob("/app/config/instaloader_session-*")
            if sessions:
                session_file = sessions[0]
                username = os.path.basename(session_file).replace("instaloader_session-", "")
                print(f"DEBUG: Intentando cargar sesion para usuario '{username}' desde '{session_file}'...", file=sys.stderr)
                L.load_session_from_file(username, filename=session_file)
                print("DEBUG: Sesion cargada correctamente.", file=sys.stderr)
            else:
                print("DEBUG: No se encontraron cookies.txt ni archivos de sesion en /app/config/", file=sys.stderr)
    except Exception as e:
        print(f"DEBUG: Error cargando cookies/sesion: {str(e)}", file=sys.stderr)

    # Para que instaloader lea la sesión global por defecto si existe:
    # L.context.log("Cargando perfil anónimo o sesión existente...")

    try:
        post = instaloader.Post.from_shortcode(L.context, shortcode)
        
        comments_data = []
        # Obtener los top 30 comentarios
        comments = post.get_comments()
        count = 0
        for comment in comments:
            if count >= 30: break
            comments_data.append({
                "author": comment.owner.username,
                "text": comment.text,
                "like_count": comment.likes_count,
                "timestamp": int(comment.created_at_utc.timestamp())
            })
            count += 1
            
        result = {
            "success": True,
            "shortcode": shortcode,
            "comments": comments_data,
            "comment_count": post.comments
        }
        print(json.dumps(result))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Falta shortcode"}))
        sys.exit(1)
        
    shortcode = sys.argv[1]
    extract_comments(shortcode)
