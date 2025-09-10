/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/index.html", "./src/**/*.{js,jsx}"],
  theme: { extend: { boxShadow: { soft: "0 10px 25px -10px rgba(0,0,0,0.25)" } } },
  plugins: []
};
