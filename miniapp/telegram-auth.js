export async function telegramLogin(apiBase, sessionKey) {
  const tg = window.Telegram?.WebApp
  const launchData = new URLSearchParams(location.hash.slice(1)).has('tgWebAppData')
  if (!tg?.initData) {
    if (launchData) throw new Error('未读取到 Telegram 登录数据，请从机器人菜单重新打开')
    return
  }
  tg.ready()
  const app = document.getElementById('app')
  const keys = [sessionKey, 'CapacitorStorage.' + sessionKey]
  for (const key of keys) localStorage.removeItem(key)
  app.textContent = '正在验证 Telegram 身份…'

  async function call(suffix = '', fields = {}) {
    const response = await fetch(apiBase + '/api/auth/telegram' + suffix, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...fields, initData: tg.initData}),
      signal: AbortSignal.timeout(15000),
    })
    const data = await response.json()
    if (!response.ok || data.ok !== true) throw new Error(data.message || '登录失败，请重试')
    return data
  }

  let result = await call()
  if (result.needsBinding) result = await new Promise(resolve => {
    app.innerHTML = '<section style="max-width:420px;margin:48px auto;padding:20px"><h2>Telegram 登录</h2><p><button id="tg-existing">已有账号，登录并绑定</button></p><p><button id="tg-new">我是新用户，直接注册</button></p><form hidden><p><label>原账号 <input name="username" autocomplete="username" required></label></p><p><label>原密码 <input name="password" type="password" autocomplete="current-password" required></label></p><button>登录并绑定</button></form><p role="alert"></p></section>'
    const form = app.querySelector('form')
    const status = app.querySelector('[role=alert]')
    const buttons = [...app.querySelectorAll('button')]
    async function submit(suffix, fields) {
      buttons.forEach(button => { button.disabled = true })
      status.textContent = '正在处理…'
      try {
        resolve(await call(suffix, fields))
      } catch (error) {
        status.textContent = error.message
        buttons.forEach(button => { button.disabled = false })
      }
    }
    app.querySelector('#tg-existing').onclick = () => { form.hidden = false }
    app.querySelector('#tg-new').onclick = () => submit('/register')
    form.onsubmit = event => {
      event.preventDefault()
      submit('/bind', Object.fromEntries(new FormData(form)))
    }
  })
  if (!result.token || !result.user?.username) throw new Error('服务器未返回登录凭据')
  const value = JSON.stringify({
    activated: true, cardKey: result.token, username: result.user.username, activatedAt: Date.now(),
  })
  for (const key of keys) localStorage.setItem(key, value)
  app.textContent = ''
}
