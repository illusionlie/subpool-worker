export function renderLoginPage() {
    return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>登录</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f0f2f5; }
            .login-box { background: #fff; padding: 40px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); width: 360px; }
            h1 { text-align: center; margin-top: 0; margin-bottom: 24px; font-size: 24px; }
            .form-group { margin-bottom: 20px; }
            input[type="password"] { width: 100%; padding: 12px; border: 1px solid #d9d9d9; border-radius: 4px; font-size: 16px; box-sizing: border-box; }
            .btn { width: 100%; padding: 12px; font-size: 16px; border-radius: 4px; border: none; background-color: #007bff; color: white; cursor: pointer; }
            .error { color: #dc3545; text-align: center; height: 1.2em; margin-top: 10px; }
        </style>
    </head>
    <body>
        <div class="login-box">
            <h1>管理员登录</h1>
            <form id="login-form">
                <div class="form-group">
                    <input type="password" id="password" placeholder="请输入密码" required autofocus>
                </div>
                <button type="submit" class="btn">登录</button>
                <p id="error-message" class="error"></p>
            </form>
        </div>
        <script>
            const form = document.getElementById('login-form');
            const passwordInput = document.getElementById('password');
            const errorMessage = document.getElementById('error-message');

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                errorMessage.textContent = '';
                const loginButton = form.querySelector('button');
                loginButton.disabled = true;
                loginButton.textContent = '登录中...';
                try {
                    const response = await fetch('/admin/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: passwordInput.value })
                    });
                    if (response.ok) {
                        window.location.reload(); // 登录成功，刷新页面，浏览器将带上新cookie
                    } else if (response.status === 429) {
                        const data = await response.json().catch(() => ({}));
                        errorMessage.textContent = data.error || '登录失败次数过多，请稍后再试';
                        errorMessage.style.color = '#dc3545';
                    } else {
                        const data = await response.json().catch(() => ({}));
                        errorMessage.textContent = data.error || '密码错误，请重试。';
                    }
                } catch (err) {
                    errorMessage.textContent = '发生网络错误。';
                } finally {
                    // 无论成功失败，都恢复按钮状态
                    loginButton.disabled = false;
                    loginButton.textContent = '登录';
                }
            });
        </script>
    </body>
    </html>
    `;
}