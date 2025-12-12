using System;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.Error.WriteLine("Usage: set-clipboard-files <file1> [file2] ...");
            return 2;
        }
        try
        {
            var list = new System.Collections.Specialized.StringCollection();
            foreach (var f in args)
            {
                if (!string.IsNullOrWhiteSpace(f))
                    list.Add(f);
            }
            if (list.Count == 0)
            {
                Console.Error.WriteLine("No valid files");
                return 3;
            }
            var dataObj = new DataObject();
            dataObj.SetFileDropList(list);
            Clipboard.SetDataObject(dataObj, true);
            Console.WriteLine("Clipboard FileDrop set, count=" + list.Count);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Clipboard set failed: " + ex.Message);
            return 5;
        }
    }
}