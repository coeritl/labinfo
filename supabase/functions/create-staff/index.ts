import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors});
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const caller = createClient(url, anon, {global:{headers:{Authorization:authHeader}}});
    const {data:{user}} = await caller.auth.getUser();
    if (!user) throw new Error("Não autenticado");
    const admin = createClient(url, service);
    const {data:profile} = await admin.from("profiles").select("role,active").eq("id",user.id).single();
    if (!profile?.active || profile.role !== "tecnico") throw new Error("Sem permissão");
    const {email,password,siape,full_name,role} = await req.json();
    if (!email || !password || !siape || !full_name || !["tecnico","supervisor"].includes(role)) throw new Error("Dados inválidos");
    const {data:created,error} = await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name,siape,role}});
    if (error) throw error;
    const {error:profileError} = await admin.from("profiles").insert({id:created.user.id,email,siape,full_name,role});
    if (profileError) { await admin.auth.admin.deleteUser(created.user.id); throw profileError; }
    return new Response(JSON.stringify({ok:true,id:created.user.id}),{headers:{...cors,"Content-Type":"application/json"}});
  } catch (error) {
    return new Response(JSON.stringify({ok:false,error:String(error.message||error)}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
  }
});
