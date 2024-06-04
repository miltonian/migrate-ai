const { exec } = require("child_process");
const glob = require("glob");

const files = glob.sync("dist/**/*.js");

files.forEach((file) => {
  exec(
    `terser ${file} -o ${file} --compress --mangle`,
    (err, stdout, stderr) => {
      if (err) {
        console.error(`Error obfuscating file ${file}:`, stderr);
      } else {
        console.log(`Successfully obfuscated ${file}`);
      }
    }
  );
});
